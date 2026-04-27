const express = require('express');
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');
// optional helpers for archive download/extraction and persistence
let fetch;
try {
  fetch = require('node-fetch');
} catch (e) {
  // node may have global fetch (Node 18+)
  fetch = global.fetch;
}
const AdmZip = require('adm-zip');
const tar = require('tar');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const cors = require('cors');
// Allow CORS during development so the frontend can call this server
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Lightweight static checks (pattern-based) for authentication-related issues
const PATTERNS = [
  // tighten hardcoded-secret: do not match when the value is an env var reference like ${VAR} or $VAR
  { id: 'hardcoded-secret', name: 'Hard-coded secret', regex: /(api_key|secret|password|passwd|token)\s*[:=]\s*["'`](?!\s*\$|\s*\$\{)[^"'`]{6,}/i, severity: 'high', recommendation: 'Remove secrets from source; use environment variables or secrets manager.' },
  { id: 'jwt-secret-env', name: 'JWT secret in code', regex: /JWT_SECRET|jwt_secret|process\.env\.JWT/i, severity: 'high', recommendation: 'Ensure JWT secrets are not committed and use env vars or secret store.' },
  { id: 'weak-password-check', name: 'Weak password policy', regex: /(min.?length.?=.?[0-6]|minimum.?length.?=.?[0-6]|minLength.?[:=]\s*\d)/i, severity: 'medium', recommendation: 'Enforce stronger minimum length (12+) and complexity.' },
  { id: 'allow-all-cors', name: 'Allow all CORS', regex: /access-control-allow-origin\s*[:=]\s*["']?\*/i, severity: 'medium', recommendation: 'Restrict CORS origins to trusted domains.' },
  { id: 'basic-auth-creds', name: 'Basic auth credentials', regex: /basic\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/, severity: 'medium', recommendation: 'Avoid embedding credentials in code or responses.' },
];

// Initialize Supabase server client if service role key present
let supabaseServer = null;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabaseServer = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    console.log('Supabase server client initialized');
  } catch (err) {
    console.warn('Failed to create Supabase server client', err.message || err);
    supabaseServer = null;
  }
} else {
  console.log('Supabase service role key not provided; scans will not be persisted to Supabase');
}

function dedupeFindings(allFindings) {
  const unique = [];
  const seen = new Map();
  for (const f of allFindings) {
    const key = `${f.id}::${f.file}::${f.snippet}`;
    if (seen.has(key)) seen.get(key).count++;
    else { const copy = Object.assign({}, f); copy.count = 1; seen.set(key, copy); unique.push(copy); }
  }
  const sevOrder = { high: 0, medium: 1, low: 2 };
  unique.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || a.file.localeCompare(b.file) || a.line - b.line);
  return unique;
}

async function extractArchive(buffer, destDir) {
  // try zip first
  try {
    const zip = new AdmZip(buffer);
    zip.extractAllTo(destDir, true);
    return true;
  } catch (e) {
    // ignore and try tar
  }
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
    const tmpFile = path.join(destDir, 'archive.tmp');
    await fs.promises.writeFile(tmpFile, buffer);
    await tar.x({ file: tmpFile, C: destDir });
    try { await fs.promises.unlink(tmpFile); } catch (e) {}
    return true;
  } catch (err) {
    return false;
  }
}

async function persistScanToSupabase(scan) {
  if (!supabaseServer) return null;
  try {
    const { data: scanData, error: scanError } = await supabaseServer.from('scans').insert([{
      repo: scan.repo || null,
      source: scan.source || 'server',
      meta: scan.meta || {},
      created_at: new Date().toISOString()
    }]).select();
    if (scanError) throw scanError;
    const scanId = scanData[0].id;
    const vulnerabilities = (scan.findings || []).map(f => ({
      scan_id: scanId,
      title: f.name || f.id,
      severity: f.severity || 'info',
      description: f.snippet || '',
      location: JSON.stringify({ file: f.file, line: f.line }),
      metadata: f,
      created_at: new Date().toISOString()
    }));
    if (vulnerabilities.length) {
      const { error: vulnError } = await supabaseServer.from('vulnerabilities').insert(vulnerabilities);
      if (vulnError) throw vulnError;
    }
    return { scanId };
  } catch (err) {
    console.error('Error persisting scan to Supabase:', err.message || err);
    return null;
  }
}

function walkDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip node_modules, .git and common test/vendor/build directories
      const skipDirs = ['node_modules', '.git', 'test', 'tests', 'vendor', 'dist', 'build', 'out'];
      if (skipDirs.includes(entry.name)) continue;
      walkDir(full, fileList);
    } else if (entry.isFile()) {
      // skip test files by filename pattern (e.g., *_test.go)
      if (/_test\./i.test(entry.name)) continue;
      // skip minified or generated files
      const skipExts = ['.min.js', '.min.css'];
      const lower = entry.name.toLowerCase();
      if (skipExts.some(s => lower.endsWith(s))) continue;
      // skip very large/binary files by extension
      const binarySkip = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.exe', '.dll', '.so', '.dylib', '.bin'];
      if (binarySkip.includes(path.extname(entry.name).toLowerCase())) continue;
      fileList.push(full);
    }
  }
  return fileList;
}

function normalizeRepoUrl(repoUrl) {
  const trimmed = String(repoUrl || '').trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    const isKnownHost = ['github.com', 'gitlab.com', 'bitbucket.org'].includes(url.hostname.toLowerCase());

    if (!isKnownHost) {
      return trimmed.replace(/#.*$/, '');
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      return trimmed.replace(/#.*$/, '');
    }

    // Keep only owner/repo so pasted web URLs like /tree/main or /issues/1 can still clone.
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    return `${url.protocol}//${url.hostname}/${owner}/${repo}`;
  } catch (err) {
    return trimmed.replace(/#.*$/, '');
  }
}

app.post('/api/scan-github', async (req, res) => {
  const { repoUrl } = req.body || {};
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  // Normalize common Git hosting URLs, but keep HTTPS repo URLs cloneable without forcing ".git".
  let cloneUrl = normalizeRepoUrl(repoUrl);

  // create temp dir
  tmp.dir({ unsafeCleanup: true }, async (err, dir, cleanup) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      // If cloneUrl looks like an archive (zip/tar), download and extract
      if (/\.(zip|tar|tar\.gz|tgz)(\?.*)?$/i.test(cloneUrl) || /\barchive\b/i.test(cloneUrl)) {
        // download archive
        const r = await fetch(cloneUrl);
        if (!r.ok) return res.status(400).json({ error: 'failed to download archive', status: r.status });
        const buf = Buffer.from(await r.arrayBuffer());
        const extractDir = path.join(dir, 'archive_extracted');
        await fs.promises.mkdir(extractDir, { recursive: true });
        const ok = await extractArchive(buf, extractDir);
        if (!ok) return res.status(400).json({ error: 'failed to extract archive' });
        const findings = [];
        const filesToScan = walkDir(extractDir);
        for (const filePath of filesToScan) {
          const ext = path.extname(filePath).toLowerCase();
          const textExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.rb', '.php', '.json', '.yaml', '.yml', '.env', '.sh', '.cfg', '.ini'];
          if (!textExts.includes(ext) && ext !== '') continue;
          let content;
          try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { continue; }
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const p of PATTERNS) {
              if (p.regex.test(line)) {
                if (/test[-_]|example|dummy|sample/i.test(line)) continue;
                const valueMatch = line.match(/[:=]\s*["'`](.*?)['"`]$/);
                if (valueMatch && /\$\{|\$[A-Za-z_]/.test(valueMatch[1])) continue;
                const before = lines[Math.max(0, i - 1)] || '';
                const after = lines[i + 1] || '';
                findings.push({ id: p.id, name: p.name, file: path.relative(extractDir, filePath), line: i + 1, snippet: line.trim(), context: `${before.trim()}\n${line.trim()}\n${after.trim()}`.trim(), severity: p.severity, recommendation: p.recommendation });
              }
            }
          }
        }
        const dedup = dedupeFindings(findings);
        await persistScanToSupabase({ repo: repoUrl, findings: dedup, source: 'archive' });
        cleanup();
        return res.json({ findings: dedup });
      }

      const git = simpleGit();
      // shallow clone to speed up
      await git.clone(cloneUrl, dir, ['--depth', '1']);

      const files = walkDir(dir);
      const findings = [];

      // Only scan text files of common types
      const textExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.rb', '.php', '.json', '.yaml', '.yml', '.env', '.sh', '.cfg', '.ini'];

      for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        if (!textExts.includes(ext) && ext !== '') continue;
        let content;
        try {
          content = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const p of PATTERNS) {
            if (p.regex.test(line)) {
              // Skip low-confidence matches that are clearly test/example placeholders
              if (/test[-_]|example|dummy|sample/i.test(line)) continue;
              // If the matched value is an env-var reference (e.g. "${FOO}" or "$FOO"), skip it as it's not a hard-coded secret
              const valueMatch = line.match(/[:=]\s*["'`](.*?)['"`]$/);
              if (valueMatch && /\$\{|\$[A-Za-z_]/.test(valueMatch[1])) {
                // skip noisy env-var interpolation
                continue;
              }

              // include one line of context before and after when possible
              const before = lines[Math.max(0, i - 1)] || '';
              const after = lines[i + 1] || '';
              findings.push({
                id: p.id,
                name: p.name,
                file: path.relative(dir, filePath),
                line: i + 1,
                snippet: line.trim(),
                context: `${before.trim()}\n${line.trim()}\n${after.trim()}`.trim(),
                severity: p.severity,
                recommendation: p.recommendation,
              });
            }
          }
        }
      }

      const deduped = dedupeFindings(findings);
      await persistScanToSupabase({ repo: repoUrl, findings: deduped, source: 'git' });

      cleanup();
      return res.json({ findings: deduped });
    } catch (e) {
      cleanup();
      const message = String(e && e.message ? e.message : e);
      if (/repository .* not found|remote: repository not found/i.test(message)) {
        return res.status(404).json({
          error: `Repository not found for "${repoUrl}". If the repo was renamed, paste its current URL from the browser address bar.`,
        });
      }
      return res.status(500).json({ error: e.message });
    }
  });
});

// Accept file uploads as JSON with base64 content and scan them directly
app.post('/api/upload', async (req, res) => {
  const { files, apiType } = req.body || {};
  if (!files || !Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'files are required' });

  const tmpdir = tmp.dirSync({ unsafeCleanup: true }).name;
  const allFindings = [];
  try {
    for (const f of files) {
      const name = f.name || 'file';
      const contentBase64 = f.content || '';
      const buf = Buffer.from(contentBase64, 'base64');
      const filePath = path.join(tmpdir, name);
      await fs.promises.writeFile(filePath, buf);

      const isArchive = /\.(zip|tar|tar\.gz|tgz)$/i.test(name);
      if (isArchive) {
        const extractDir = path.join(tmpdir, name + '_extracted');
        await fs.promises.mkdir(extractDir, { recursive: true });
        const ok = await extractArchive(buf, extractDir);
        if (ok) {
          const filesToScan = walkDir(extractDir);
          for (const p of filesToScan) {
            // reuse upload scanning logic per-file
            const content = await fs.promises.readFile(p, 'utf8').catch(() => null);
            if (!content) continue;
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              for (const pattern of PATTERNS) {
                if (pattern.regex.test(line)) {
                  if (/test[-_]|example|dummy|sample/i.test(line)) continue;
                  const valueMatch = line.match(/[:=]\s*["'`](.*?)['"`]$/);
                  if (valueMatch && /\$\{|\$[A-Za-z_]/.test(valueMatch[1])) continue;
                  const before = lines[Math.max(0, i - 1)] || '';
                  const after = lines[i + 1] || '';
                  allFindings.push({ id: pattern.id, name: pattern.name, file: path.relative(extractDir, p), line: i + 1, snippet: line.trim(), context: `${before.trim()}\n${line.trim()}\n${after.trim()}`.trim(), severity: pattern.severity, recommendation: pattern.recommendation });
                }
              }
            }
          }
          continue;
        }
      }

      // non-archive: scan raw content
      const content = buf.toString('utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const p of PATTERNS) {
          if (p.regex.test(line)) {
            if (/test[-_]|example|dummy|sample/i.test(line)) continue;
            const valueMatch = line.match(/[:=]\s*["'`](.*?)['"`]$/);
            if (valueMatch && /\$\{|\$[A-Za-z_]/.test(valueMatch[1])) continue;
            const before = lines[Math.max(0, i - 1)] || '';
            const after = lines[i + 1] || '';
            allFindings.push({ id: p.id, name: p.name, file: name, line: i + 1, snippet: line.trim(), context: `${before.trim()}\n${line.trim()}\n${after.trim()}`.trim(), severity: p.severity, recommendation: p.recommendation });
          }
        }
      }
    }

    const dedup = dedupeFindings(allFindings);
    await persistScanToSupabase({ repo: null, findings: dedup, source: 'upload' });
    return res.json({ findings: dedup });
  } catch (e) {
    console.error('Upload scan error', e);
    return res.status(500).json({ error: String(e) });
  } finally {
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (e) {}
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GitHub scan server listening on http://localhost:${PORT}`));
