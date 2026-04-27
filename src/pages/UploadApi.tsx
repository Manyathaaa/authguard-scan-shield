import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileJson, CheckCircle2, Loader2, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { createScan, updateScan } from "@/lib/scanService";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SPEC_BUCKET = (import.meta.env.VITE_SPEC_BUCKET as string) || "specs";

const mockEndpoints = [
  { method: "POST", path: "/api/auth/login", type: "Login" },
  { method: "POST", path: "/api/auth/register", type: "Registration" },
  { method: "POST", path: "/api/auth/forgot-password", type: "Password Reset" },
  { method: "POST", path: "/api/auth/refresh-token", type: "Token Refresh" },
  { method: "GET", path: "/api/auth/me", type: "User Profile" },
];

export default function UploadApi() {
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const [fileType, setFileType] = useState<string>("");
  const [scanId, setScanId] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [githubUrl, setGithubUrl] = useState("");
  const [repoFindings, setRepoFindings] = useState<any[] | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

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
    let successCount = 0;
    let failCount = 0;
    const firstScanIds: string[] = [];

    for (const file of files) {
      try {
          const apiType = fileType.includes("Swagger") ? "swagger" : "postman";
          // Read file contents and POST to server /api/upload for scanning
          const text = await file.text();
          const base64 = btoa(unescape(encodeURIComponent(text)));
          const resp = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ name: file.name, content: base64 }], apiType }) });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Upload scan failed');
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

  const handleDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    const items = Array.from(ev.dataTransfer.files || []);
    if (items.length) processFiles(items);
  };

  const handleDragOver = (ev: React.DragEvent<HTMLDivElement>) => ev.preventDefault();

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
        {/* Note: file selection is handled by the drag/drop area below */}
        {/* Drag and drop area */}
        <div className="mb-6">
          <div onDrop={handleDrop} onDragOver={handleDragOver} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') fileInputRef.current?.click(); }} className="rounded-md border-2 border-dashed border-border p-6 text-center bg-card">
            <div className="flex items-center justify-center gap-3">
              <Upload className="h-6 w-6 text-primary" />
              <div>
                <div className="font-semibold">Drag & drop files here</div>
                <div className="text-sm text-muted-foreground">or click to select files</div>
              </div>
            </div>
            {selectedFiles.length > 0 && (
              <div className="mt-4 text-left">
                <div className="text-sm font-medium mb-2">Selected files</div>
                <ul className="space-y-1">
                  {selectedFiles.map((f) => (
                    <li key={f.name} className="text-sm text-muted-foreground">{f.name} · {Math.round(f.size/1024)} KB</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
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
                <h4 className="text-sm font-medium">Findings</h4>
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
              <div className="flex items-center gap-2 mb-6 text-primary">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">{mockEndpoints.length} authentication endpoints detected</span>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-secondary/50 px-4 py-3 text-sm font-mono text-muted-foreground border-b border-border">Detected Endpoints</div>
                {mockEndpoints.map((ep, i) => (
                  <motion.div key={ep.path} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${ep.method === "POST" ? "bg-cyber-blue/10 text-cyber-blue" : "bg-primary/10 text-primary"}`}>{ep.method}</span>
                    <span className="font-mono text-sm flex-1">{ep.path}</span>
                    <span className="text-xs text-muted-foreground">{ep.type}</span>
                  </motion.div>
                ))}
              </div>

              <div className="mt-8 flex gap-4">
                <Button onClick={() => navigate("/scanner", { state: { scanId } })} className="glow-green font-mono">
                  Run Scanner <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => { setStatus("idle"); setScanId(null); }} className="font-mono">Upload Another</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
