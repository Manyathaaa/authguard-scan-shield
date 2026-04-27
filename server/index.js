const express = require('express');
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');

const app = express();
const cors = require('cors');
// Allow CORS during development so the frontend can call this server
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Lightweight static checks (pattern-based) for authentication-related issues
const PATTERNS = [
  // tighten hardcoded-secret: do not match when the value is an env var reference like ${VAR} or $VAR
  { id: 'hardcoded-secret', name: 'Hard-coded secret', regex: /(api_key|secret|password|passwd|token)\s*[:=]\s*["'`](?!\s*\$|\s*\$\{)[^"'`]{6,}/i, severity: 'high', recommendation: 'Remove secrets from source; use environment variables or secrets manager.' },
  { id: 'jwt-secret-env', name: 'JWT secret in code', regex: /JWT_SECRET|jwt_secret|process\.env\.JWT/i, severity: 'high', recommendation: 'Ensure JWT secrets are not committed and use env vars or secret store.' },
  { id: 'weak-password-check', name: 'Weak password policy', regex: /(min.?length.?=.?[0-6]|minimum.?length.?=.?[0-6]|minLength.?[:=]\s*\d)/i, severity: 'medium', recommendation: 'Enforce stronger minimum length (12+) and complexity.' },
  { id: 'allow-all-cors', name: 'Allow all CORS', regex: /access-control-allow-origin\s*[:=]\s*["']?\*/i, severity: 'medium', recommendation: 'Restrict CORS origins to trusted domains.' },
  { id: 'basic-auth-creds', name: 'Basic auth credentials', regex: /basic\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/, severity: 'medium', recommendation: 'Avoid embedding credentials in code or responses.' },
];

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

app.post('/api/scan-github', async (req, res) => {
  const { repoUrl } = req.body || {};
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  // create temp dir
  tmp.dir({ unsafeCleanup: true }, async (err, dir, cleanup) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const git = simpleGit();
      // shallow clone to speed up
      await git.clone(repoUrl, dir, ['--depth', '1']);

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
                  const valueMatch = line.match(/[:=]\s*["'`](.*?)["'`]$/);
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

      // Deduplicate similar findings (same id + file + snippet)
      const unique = [];
      const seen = new Map();
      for (const f of findings) {
        const key = `${f.id}::${f.file}::${f.snippet}`;
        if (seen.has(key)) {
          seen.get(key).count++;
        } else {
          const copy = Object.assign({}, f);
          copy.count = 1;
          seen.set(key, copy);
          unique.push(copy);
        }
      }

      // sort by severity first (high -> medium -> low) then by file
      const sevOrder = { high: 0, medium: 1, low: 2 };
      unique.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || a.file.localeCompare(b.file) || a.line - b.line);

      cleanup();
      return res.json({ findings: unique });
    } catch (e) {
      cleanup();
      return res.status(500).json({ error: e.message });
    }
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GitHub scan server listening on http://localhost:${PORT}`));
