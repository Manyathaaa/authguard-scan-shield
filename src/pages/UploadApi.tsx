import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileJson, CheckCircle2, Loader2, Globe, ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { createScan, updateScan } from "@/lib/scanService";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SPEC_BUCKET = (import.meta.env.VITE_SPEC_BUCKET as string) || "specs";

function looksLikeApiSpec(text: string, apiType: string) {
  const sample = text.slice(0, 5000);
  if (apiType === "swagger" || apiType === "postman") return true;
  return (
    /\bopenapi\b/i.test(sample) ||
    /\bswagger\b/i.test(sample) ||
    /(^|\n)\s*paths\s*:/i.test(sample) ||
    /"paths"\s*:\s*\{/i.test(sample) ||
    /"collection"\s*:\s*\{/i.test(sample) ||
    /"item"\s*:\s*\[/i.test(sample)
  );
}

function extractJsonObjectFromText(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeEndpointPath(url: string) {
  const value = String(url || "").trim();
  if (!value) return "/";
  try {
    if (/^https?:\/\//i.test(value)) {
      return new URL(value).pathname || "/";
    }
  } catch {}
  return value;
}

function extractSpecLikeEndpoints(text: string) {
  const endpoints: { method: string; path: string; type: string }[] = [];
  const seen = new Set<string>();
  const addEndpoint = (method: string, rawPath: string, type: string) => {
    const pathValue = String(rawPath || "").trim();
    if (!pathValue.startsWith("/") || pathValue.length < 2 || pathValue.length > 200) return;
    const key = `${method}::${pathValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    endpoints.push({ method, path: pathValue, type });
  };

  const pathKeyRegex = /^[ \t]*["']?(\/[A-Za-z0-9._~\-\/{}:,@]+)["']?\s*:\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pathKeyRegex.exec(text)) !== null) {
    const pathValue = match[1];
    const lookahead = text.slice(match.index, match.index + 800);
    const methodMatches = [...lookahead.matchAll(/^[ \t]*["']?(get|post|put|patch|delete|options|head|trace)["']?\s*:/gim)];
    for (const methodMatch of methodMatches) {
      addEndpoint(methodMatch[1].toUpperCase(), pathValue, "heuristic");
    }
  }

  const inlineJsonRegex = /"(\/[A-Za-z0-9._~\-\/{}:,@]+)"\s*:\s*\{[\s\S]{0,500}?"(get|post|put|patch|delete|options|head|trace)"\s*:/gi;
  while ((match = inlineJsonRegex.exec(text)) !== null) {
    addEndpoint(match[2].toUpperCase(), match[1], "heuristic");
  }

  const methodPathRegex = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE)\b\s+(\/[A-Za-z0-9._~\-\/{}:,@]+)/gi;
  while ((match = methodPathRegex.exec(text)) !== null) {
    addEndpoint(match[1].toUpperCase(), match[2], "pdf-text");
  }

  const postmanTextRegex = /"method"\s*:\s*"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE)"[\s\S]{0,250}?"url"\s*:\s*"(https?:\/\/[^"\s]+|\/[^"\s]+)"/gi;
  while ((match = postmanTextRegex.exec(text)) !== null) {
    addEndpoint(match[1].toUpperCase(), normalizeEndpointPath(match[2]), "postman-text");
  }

  return endpoints;
}

// Lightweight spec parser: extract endpoints from OpenAPI (JSON/YAML) or Postman Collection
function extractEndpointsFromSpec(text: string, apiType: string) {
  try {
    if (apiType === 'postman' || text.trim().startsWith('{')) {
      // Try JSON parsing first
      const parsed = JSON.parse(text);
      // Postman collection v2 has item arrays with request.method and request.url
      if (parsed?.item && Array.isArray(parsed.item)) {
        const endpoints: any[] = [];
        const walkItems = (items: any[]) => {
          for (const it of items) {
            if (it.request) {
              const method = (it.request.method || 'GET').toUpperCase();
              let url = '';
              if (typeof it.request.url === 'string') url = it.request.url;
              else if (it.request.url && it.request.url.raw) url = it.request.url.raw;
              else if (it.request.url && it.request.url.path) url = '/' + (Array.isArray(it.request.url.path) ? it.request.url.path.join('/') : String(it.request.url.path));
              endpoints.push({ method, path: normalizeEndpointPath(url), type: 'Detected' });
            }
            if (it.item && Array.isArray(it.item)) walkItems(it.item);
          }
        };
        walkItems(parsed.item);
        return endpoints;
      }
    }

    // Try OpenAPI (JSON or YAML). We'll attempt JSON parse first, then YAML via dynamic import if available.
    let doc: any;
    try { doc = JSON.parse(text); } catch (e) { }
    if (!doc && looksLikeApiSpec(text, apiType)) {
      doc = extractJsonObjectFromText(text);
    }
    if (!doc) {
      // Lightweight YAML parsing for common OpenAPI files (paths/methods)
      // This avoids adding a heavy dependency in the frontend and handles typical YAML structure.
      const yamlPathsMatch = /(^|\n)paths:\s*\n([\s\S]*)$/i.exec(text);
      if (yamlPathsMatch) {
        const rest = yamlPathsMatch[2];
        // Match path entries that start with whitespace then '/something':
        const pathRegex = /^\s{2,}([\/~A-Za-z0-9_\-{}:\[\]\.@\,]+):\s*\n([\s\S]*?)(?=^\s{2,}[\/~A-Za-z0-9_\-{}:\[\]\.@\,]+:|\n[^\s])/gim;
        const endpoints: any[] = [];
        // Fallback simpler parsing: look for lines that start with two spaces then '/'
        const lines = rest.split(/\r?\n/);
        let currentPath: string | null = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const pathLine = line.match(/^\s{2,}([\/~A-Za-z0-9_\-{}:\[\]\.@\,]+):\s*$/);
          if (pathLine) {
            currentPath = pathLine[1].trim();
            continue;
          }
          if (currentPath) {
            const methodLine = line.match(/^\s{4,}([a-z]+):\s*$/i);
            if (methodLine) {
              endpoints.push({ method: methodLine[1].toUpperCase(), path: currentPath, type: 'Detected' });
            }
            // stop if indentation goes back to top-level
            if (/^\S/.test(line)) { currentPath = null; }
          }
        }
        if (endpoints.length) return endpoints;
      }
      doc = null;
    }

    if (doc && doc.paths) {
      const endpoints: any[] = [];
      for (const p of Object.keys(doc.paths)) {
        const methods = Object.keys(doc.paths[p] || {});
        for (const m of methods) {
          endpoints.push({ method: m.toUpperCase(), path: p, type: 'Detected' });
        }
      }
      return endpoints;
    }

    if (looksLikeApiSpec(text, apiType)) {
      return extractSpecLikeEndpoints(text);
    }
  } catch (err) {
    // parsing failed, return empty
  }
  return [];
}

export default function UploadApi() {
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const [fileType, setFileType] = useState<string>("");
  const [scanId, setScanId] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [githubUrl, setGithubUrl] = useState("");
  const [repoFindings, setRepoFindings] = useState<any[] | null>(null);
  const [detectedEndpoints, setDetectedEndpoints] = useState<{ method: string; path: string; type?: string }[] | null>(null);
  const [rawServerResponse, setRawServerResponse] = useState<any | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const exportRepoFindingsPdf = () => {
    if (!repoFindings || repoFindings.length === 0) return;

    const escapeHtml = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const reportHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>AuthGuard GitHub Findings</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 32px;
              color: #111827;
              background: #ffffff;
            }
            h1 {
              margin: 0 0 8px;
              font-size: 28px;
            }
            .meta {
              color: #4b5563;
              margin-bottom: 24px;
              font-size: 14px;
            }
            .finding {
              border: 1px solid #d1d5db;
              border-radius: 10px;
              padding: 16px;
              margin-bottom: 16px;
              page-break-inside: avoid;
            }
            .file {
              color: #6b7280;
              font-family: monospace;
              font-size: 12px;
              margin-bottom: 8px;
            }
            .title {
              font-size: 18px;
              font-weight: 700;
              margin-bottom: 8px;
            }
            .snippet {
              font-family: monospace;
              background: #f3f4f6;
              padding: 10px;
              border-radius: 8px;
              margin-bottom: 10px;
              white-space: pre-wrap;
              word-break: break-word;
            }
            .recommendation {
              color: #374151;
              font-size: 14px;
            }
            @media print {
              body { margin: 20px; }
            }
          </style>
        </head>
        <body>
          <h1>AuthGuard GitHub Findings</h1>
          <div class="meta">
            Repository: ${escapeHtml(githubUrl || "GitHub repository")}<br />
            Generated: ${escapeHtml(new Date().toLocaleString())}<br />
            Findings: ${repoFindings.length}
          </div>
          ${repoFindings.map((finding: any) => `
            <section class="finding">
              <div class="file">${escapeHtml(`${finding.file || "unknown"}:${finding.line || "-"}`)}</div>
              <div class="title">${escapeHtml(finding.name || "Finding")} - ${escapeHtml(finding.severity || "unknown")}</div>
              <div class="snippet">${escapeHtml(finding.snippet || "")}</div>
              <div class="recommendation">${escapeHtml(finding.recommendation || "")}</div>
            </section>
          `).join("")}
          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!printWindow) {
      toast({
        title: "Export blocked",
        description: "Allow pop-ups for this site to export the findings as PDF.",
        variant: "destructive",
      });
      return;
    }

    printWindow.document.open();
    printWindow.document.write(reportHtml);
    printWindow.document.close();
  };

  const handleUpload = async (type: string) => {
    // Deprecated simulated upload path retained as fallback.
    setFileType(type);
    // Trigger file picker instead of directly uploading simulated data
    if (fileInputRef.current) {
      // Allow any file type and multiple selection
      fileInputRef.current.accept = "*/*";
      fileInputRef.current.multiple = true;
      fileInputRef.current.click();
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;

    setSelectedFiles(files);
    setStatus("uploading");
    setDetectedEndpoints(null);
    setRawServerResponse(null);
    setRepoFindings(null);
    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      try {
          // determine apiType: prefer explicit selection, otherwise try to detect from file contents
          const text = await file.text();
          let apiType = fileType && fileType.includes("Swagger") ? "swagger" : "postman";
          const trimmed = text.trim();
          if (!fileType) {
            if (/\bopenapi\b|\bswagger\b|\bpaths\b/i.test(trimmed) || trimmed.startsWith('openapi') || trimmed.startsWith('{"openapi') || /^paths:\s*$/m.test(trimmed)) {
              apiType = 'swagger';
            } else if (/"collection"\s*:\s*\{/i.test(trimmed) || /"item"\s*:\s*\[/i.test(trimmed)) {
              apiType = 'postman';
            }
          }

          // Try to extract endpoints locally from Swagger/OpenAPI or Postman collection
          try {
            const endpoints = extractEndpointsFromSpec(text, apiType) || [];
            // always set detectedEndpoints (use empty array when nothing found)
            setDetectedEndpoints(endpoints);
          } catch (e) {
            setDetectedEndpoints([]);
          }

          // Read file contents and POST to server /api/upload for scanning
          const base64 = btoa(unescape(encodeURIComponent(text)));
          const resp = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ name: file.name, content: base64 }], apiType }) });
          const data = await resp.json();
          setRawServerResponse(data);
          if (!resp.ok) throw new Error(data.error || 'Upload scan failed');
          // If the server returned endpoints, prefer them (more reliable than the frontend heuristic)
          if (data.endpoints && Array.isArray(data.endpoints)) {
            setDetectedEndpoints(data.endpoints.map((e: any) => ({ method: (e.method || 'GET').toUpperCase(), path: e.path || e.url || e.route || '/', type: e.type || 'Detected' })));
          }
          // If there are findings, show them in repoFindings area
          if (data.findings && data.findings.length > 0) {
            setRepoFindings(data.findings);
          }
          successCount++;
      } catch (err: any) {
        failCount++;
        const msg = err?.message || String(err);
        // Provide a clearer message when the bucket is missing
        if (msg.toLowerCase().includes("bucket not found")) {
          toast({
            title: "Upload Error — Bucket not found",
            description: `The storage bucket \"${SPEC_BUCKET}\" was not found. Create it in your Supabase dashboard or set VITE_SPEC_BUCKET to an existing bucket.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Upload Error", description: msg, variant: "destructive" });
        }
      }
    }

    // finalize UI state
    if (successCount > 0) {
      setScanId(null);
      // small delay so progress bar can show
      setTimeout(() => setStatus("done"), 400);
      toast({ title: "Upload Complete", description: `${successCount} file(s) uploaded${failCount ? `, ${failCount} failed` : ''}.`, variant: "default" });
    } else {
      setStatus("idle");
    }
    // clear input so same files can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
    // clear selected files after done
    setTimeout(() => setSelectedFiles([]), 2000);
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
  };

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Hidden file input used to pick spec files for upload */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-2">Upload API Specification</h1>
          <p className="text-muted-foreground mb-10">
            Upload your Swagger or Postman Collection to discover authentication endpoints.
          </p>

          <div className="mb-8">
            <h3 className="text-sm font-medium mb-2">Or scan a public GitHub repository</h3>
            <div className="flex gap-2">
              <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/user/repo.git" className="flex-1 rounded border border-border px-3 py-2 bg-card" />
              <Button onClick={async () => {
                if (!githubUrl) return;
                setRepoFindings(null);
                try {
                  const resp = await fetch('/api/scan-github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoUrl: githubUrl }) });
                  const data = await resp.json();
                  if (!resp.ok) throw new Error(data.error || 'Scan failed');
                  // Client-side filter: remove overly generic matches like single-char lines
                  const filtered = (data.findings || []).filter((f: any) => {
                    if (!f || !f.snippet) return false;
                    // drop snippets that are too short or clearly noise
                    if (f.snippet.length < 6) return false;
                    return true;
                  });
                  setRepoFindings(filtered);
                } catch (e: any) {
                  toast({ title: 'Scan error', description: e.message || String(e), variant: 'destructive' });
                }
              }} className="glow-green">Scan</Button>
            </div>

            {repoFindings && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <h4 className="text-sm font-medium">Findings</h4>
                  <div className="flex items-center gap-2">
                    <Button onClick={exportRepoFindingsPdf} variant="outline" className="font-mono">
                      <Download className="mr-2 h-4 w-4" /> Export PDF
                    </Button>
                    <Button
                      onClick={() =>
                        navigate("/scanner", {
                          state: {
                            sourceLabel: githubUrl ? `GitHub repo: ${githubUrl}` : "GitHub repository",
                            apiType: "github",
                            endpoints: [],
                            repoFindings,
                          },
                        })
                      }
                      className="glow-green font-mono"
                    >
                      Run Scanner <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {repoFindings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No issues found.</p>
                ) : (
                  repoFindings.map((f: any, i: number) => (
                    <div key={`${f.file}-${f.line}-${i}`} className="p-3 rounded border bg-card">
                      <div className="text-xs font-mono text-muted-foreground">{f.file}:{f.line}</div>
                      <div className="font-semibold">{f.name} — <span className="text-xs text-muted-foreground">{f.severity}</span></div>
                      <div className="text-sm mt-1">{f.snippet}</div>
                      <div className="text-xs text-muted-foreground mt-2">{f.recommendation}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </motion.div>

        {status === "idle" && (
          <div className="grid md:grid-cols-2 gap-6">
            {[
              { type: "Swagger / OpenAPI", icon: Globe, ext: ".yaml / .json" },
              { type: "Postman Collection", icon: FileJson, ext: ".json" },
            ].map((item) => (
              <motion.button
                key={item.type}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleUpload(item.type)}
                className="p-8 rounded-lg border-2 border-dashed border-border hover:border-primary/50 bg-card transition-colors text-left group"
              >
                <item.icon className="h-10 w-10 text-primary mb-4" />
                <h3 className="text-lg font-semibold mb-1">{item.type}</h3>
                <p className="text-sm text-muted-foreground">Upload {item.ext} file</p>
                <div className="mt-6 flex items-center gap-2 text-sm text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload className="h-4 w-4" /> Click to upload
                </div>
              </motion.button>
            ))}
          </div>
        )}

        {status === "uploading" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />
            <p className="text-lg font-medium mb-2">Analyzing {fileType}...</p>
            <p className="text-sm text-muted-foreground">Scanning for authentication endpoints</p>
            <div className="mt-8 max-w-md mx-auto">
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <motion.div className="h-full bg-primary rounded-full" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 2.5 }} />
              </div>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {status === "done" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              {detectedEndpoints !== null ? (
                detectedEndpoints.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2 mb-6 text-primary">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">{detectedEndpoints.length} authentication endpoints detected</span>
                    </div>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="bg-secondary/50 px-4 py-3 text-sm font-mono text-muted-foreground border-b border-border">Detected Endpoints</div>
                      {detectedEndpoints.map((ep, i) => (
                        <motion.div key={`${ep.method}-${ep.path}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${ep.method === "POST" ? "bg-cyber-blue/10 text-cyber-blue" : "bg-primary/10 text-primary"}`}>{ep.method}</span>
                          <span className="font-mono text-sm flex-1">{ep.path}</span>
                          <span className="text-xs text-muted-foreground">{ep.type}</span>
                        </motion.div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No authentication endpoints were detected in the uploaded file.</div>
                )
              ) : (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No endpoint data is available for this upload yet.
                </div>
              )}

              <div className="mt-8 flex gap-4">
                <Button
                  onClick={() =>
                    navigate("/scanner", {
                      state: {
                        scanId,
                        endpoints: detectedEndpoints || [],
                        apiType: fileType?.includes("Postman") ? "postman" : "swagger",
                        sourceLabel: selectedFiles.map((f) => f.name).join(", ") || "Uploaded API spec",
                      },
                    })
                  }
                  className="glow-green font-mono"
                >
                  Run Scanner <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => { setStatus("idle"); setScanId(null); }} className="font-mono">Upload Another</Button>
              </div>
              {rawServerResponse && (
                <div className="mt-6 p-3 rounded border bg-card text-xs font-mono text-muted-foreground">
                  <div className="font-medium mb-2">Server response (debug)</div>
                  <pre className="whitespace-pre-wrap">{JSON.stringify(rawServerResponse, null, 2)}</pre>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
