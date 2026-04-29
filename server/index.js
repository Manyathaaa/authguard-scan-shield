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
const yaml = require('js-yaml');
const { PDFParse } = require('pdf-parse');
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

function looksLikeApiSpec(text, apiType) {
  const sample = String(text || '').slice(0, 5000);
  if (apiType === 'swagger' || apiType === 'postman') return true;
  return (
    /\bopenapi\b/i.test(sample) ||
    /\bswagger\b/i.test(sample) ||
    /(^|\n)\s*paths\s*:/i.test(sample) ||
    /"paths"\s*:\s*\{/i.test(sample) ||
    /"collection"\s*:\s*\{/i.test(sample) ||
    /"item"\s*:\s*\[/i.test(sample)
  );
}

function extractSpecLikeEndpoints(text) {
  const endpoints = [];
  const seen = new Set();
  const addEndpoint = (method, rawPath, type) => {
    const pathValue = String(rawPath || '').trim();
    if (!pathValue.startsWith('/')) return;
    if (pathValue.length < 2 || pathValue.length > 200) return;
    const key = `${method}::${pathValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    endpoints.push({ method, path: pathValue, type });
  };

  const pathKeyRegex = /^[ \t]*["']?(\/[A-Za-z0-9._~\-\/{}:,@]+)["']?\s*:\s*$/gm;
  let match;
  while ((match = pathKeyRegex.exec(text)) !== null) {
    const pathValue = match[1];
    const lookahead = text.slice(match.index, match.index + 800);
    const methodMatches = [...lookahead.matchAll(/^[ \t]*["']?(get|post|put|patch|delete|options|head|trace)["']?\s*:/gim)];
    for (const methodMatch of methodMatches) {
      addEndpoint(methodMatch[1].toUpperCase(), pathValue, 'heuristic');
    }
  }

  const inlineJsonRegex = /"(\/[A-Za-z0-9._~\-\/{}:,@]+)"\s*:\s*\{[\s\S]{0,500}?"(get|post|put|patch|delete|options|head|trace)"\s*:/gi;
  while ((match = inlineJsonRegex.exec(text)) !== null) {
    addEndpoint(match[2].toUpperCase(), match[1], 'heuristic');
  }

  return endpoints;
}

function extractEndpointsFromText(text, apiType) {
  try {
    // Try JSON parse first
    let doc = null;
    try { doc = JSON.parse(text); } catch (e) { doc = null; }

    const endpoints = [];
    if (apiType === 'postman' || (doc && doc.item)) {
      const parsed = doc || JSON.parse(text);
      const walk = (items) => {
        for (const it of items) {
          if (it.request) {
            const method = (it.request.method || 'GET').toUpperCase();
            let url = '';
            if (typeof it.request.url === 'string') url = it.request.url;
            else if (it.request.url && it.request.url.raw) url = it.request.url.raw;
            else if (it.request.url && it.request.url.path) url = '/' + (Array.isArray(it.request.url.path) ? it.request.url.path.join('/') : String(it.request.url.path));
            endpoints.push({ method, path: url, type: 'postman' });
          }
          if (it.item && Array.isArray(it.item)) walk(it.item);
        }
      };
      if (parsed.item && Array.isArray(parsed.item)) walk(parsed.item);
      return endpoints;
    }

    // OpenAPI/Swagger
    if (!doc) {
      // try YAML parse
      try { doc = yaml.load(text); } catch (e) { /* ignore */ }
    }
    if (doc && doc.paths) {
      const validMethods = new Set(['get','post','put','patch','delete','head','options','trace']);
      for (const p of Object.keys(doc.paths)) {
        const target = doc.paths[p] || {};
        // prefer wrapper-style (methods/operations) which contain real verb keys
        const wrapperKeys = ['methods', 'operations', 'x-methods', 'httpMethods'];
        let found = false;
        for (const wk of wrapperKeys) {
          if (target[wk] && typeof target[wk] === 'object') {
            const inner = target[wk];
            for (const m of Object.keys(inner)) {
              if (validMethods.has(m.toLowerCase())) { endpoints.push({ method: m.toUpperCase(), path: p, type: 'openapi' }); found = true; }
            }
            if (found) break;
          }
        }
        if (found) continue;

        // direct methods (e.g. post/get) - only accept known HTTP verbs
        const directMethods = Object.keys(target).filter(k => validMethods.has(k.toLowerCase()));
        if (directMethods.length) {
          for (const m of directMethods) endpoints.push({ method: m.toUpperCase(), path: p, type: 'openapi' });
          continue;
        }

        // fallback: check child objects for verb keys
        const childKeys = Object.keys(target);
        for (const ck of childKeys) {
          const child = target[ck];
          if (child && typeof child === 'object') {
            const maybeMethods = Object.keys(child).filter(k => validMethods.has(k.toLowerCase()));
            if (maybeMethods.length) {
              for (const m of maybeMethods) endpoints.push({ method: m.toUpperCase(), path: p, type: 'openapi' });
              found = true; break;
            }
          }
        }
      }
      return endpoints;
    }

    // Fallback: quick YAML heuristic for 'paths:' block
    const yamlPathsMatch = /(^|\n)paths:\s*\n([\s\S]*)$/i.exec(text);
    if (yamlPathsMatch) {
      const rest = yamlPathsMatch[2];
      const lines = rest.split(/\r?\n/);
      let currentPath = null;
      for (const line of lines) {
        const pathLine = line.match(/^\s{2,}([\/~A-Za-z0-9_\-{}:\[\]\.@,]+):\s*$/);
        if (pathLine) { currentPath = pathLine[1].trim(); continue; }
        if (currentPath) {
          const methodLine = line.match(/^\s{4,}([a-z]+):\s*$/i);
          if (methodLine) endpoints.push({ method: methodLine[1].toUpperCase(), path: currentPath, type: 'openapi' });
          if (/^\S/.test(line)) currentPath = null;
        }
      }
    }

    if (endpoints.length === 0 && looksLikeApiSpec(text, apiType)) {
      return extractSpecLikeEndpoints(text);
    }

    return endpoints;
  } catch (e) {
    return [];
  }
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

async function readUploadedText(name, buffer) {
  const lowerName = String(name || '').toLowerCase();
  if (lowerName.endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text || '';
    } finally {
      await parser.destroy();
    }
  }
  return buffer.toString('utf8');
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
  let endpoints = [];
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

      // non-archive: scan raw content (including text extracted from PDFs)
      const content = await readUploadedText(name, buf);
      // attempt to extract endpoints from uploaded spec content
      try {
        const eps = extractEndpointsFromText(content, apiType);
        if (eps && eps.length) endpoints = (endpoints || []).concat(eps);
      } catch (e) {}
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
    // dedupe endpoints too
    const uniqEndpoints = [];
    const seenE = new Set();
    if (typeof endpoints !== 'undefined' && Array.isArray(endpoints)) {
      for (const e of endpoints) {
        const k = `${(e.method||'GET')}::${e.path}`;
        if (!seenE.has(k)) { seenE.add(k); uniqEndpoints.push(e); }
      }
    }
  console.log('upload scan: found endpoints:', uniqEndpoints);
  return res.json({ findings: dedup, endpoints: uniqEndpoints });
  } catch (e) {
    console.error('Upload scan error', e);
    return res.status(500).json({ error: String(e) });
  } finally {
    try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch (e) {}
  }
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => console.log(`GitHub scan server listening on http://localhost:${PORT}`));

// Graceful shutdown helper
function gracefulShutdown(reason, err, code = 1) {
  try {
    if (err) {
      console.error(`Shutting down due to ${reason}:`, err && err.stack ? err.stack : err);
    } else {
      console.log(`Shutting down due to ${reason}`);
    }
    // stop accepting new connections
    if (server && server.close) {
      server.close(() => {
        console.log('Server closed. Exiting.');
        process.exit(code);
      });
      // Force exit if close hangs
      setTimeout(() => {
        console.error('Forcing exit after timeout.');
        process.exit(code);
      }, 5000).unref();
    } else {
      process.exit(code);
    }
  } catch (shutdownErr) {
    console.error('Error during graceful shutdown:', shutdownErr);
    process.exit(code);
  }
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`A server is probably already running on http://localhost:${PORT}`);
    console.error('Stop the existing process or start this server with a different port, for example:');
    console.error(`PORT=${Number(PORT) + 1} npm start`);
    // Use graceful shutdown flow to ensure logs flush
    return gracefulShutdown('EADDRINUSE', err, 1);
  }

  console.error('Server error:', err);
  return gracefulShutdown('server error', err, 1);
});

// Global process-level handlers for more robust error reporting and cleanup
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // try to shutdown gracefully
  gracefulShutdown('unhandledRejection', reason, 1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
  // best-effort graceful shutdown
  gracefulShutdown('uncaughtException', err, 1);
});

// Handle termination signals (CTRL+C, systemd stop, etc.) and exit cleanly
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`Received ${sig}, initiating graceful shutdown...`);
    gracefulShutdown(sig, null, 0);
  });
});
