# AuthGuard Scan Server

Small Express server that clones a public GitHub repository and runs simple static pattern-based checks to detect potential authentication-related issues.

Usage:

1. Install dependencies:

```bash
cd server
npm install
```

2. Start server:

```bash
npm start
```

3. POST to `/api/scan-github` with JSON body { "repoUrl": "https://github.com/user/repo.git" }

Response: JSON with `findings` array.

Notes:
- This is a lightweight demo scanner (regex-based). For production use, replace with robust static analysis or dynamic scanning.
- The server clones the repo with `--depth 1` for speed and deletes the temp directory after scan.
