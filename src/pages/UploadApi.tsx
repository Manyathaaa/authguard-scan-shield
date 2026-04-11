import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileJson, CheckCircle2, Loader2, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

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

  const handleUpload = (type: string) => {
    setFileType(type);
    setStatus("uploading");
    setTimeout(() => setStatus("done"), 2500);
  };

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-2">Upload API Specification</h1>
          <p className="text-muted-foreground mb-10">
            Upload your Swagger or Postman Collection to discover authentication endpoints.
          </p>
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />
            <p className="text-lg font-medium mb-2">Analyzing {fileType}...</p>
            <p className="text-sm text-muted-foreground">Scanning for authentication endpoints</p>
            <div className="mt-8 max-w-md mx-auto">
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <motion.div
                  className="h-full bg-primary rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2.5 }}
                />
              </div>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {status === "done" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center gap-2 mb-6 text-primary">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">
                  {mockEndpoints.length} authentication endpoints detected
                </span>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-secondary/50 px-4 py-3 text-sm font-mono text-muted-foreground border-b border-border">
                  Detected Endpoints
                </div>
                {mockEndpoints.map((ep, i) => (
                  <motion.div
                    key={ep.path}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/30 transition-colors"
                  >
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      ep.method === "POST" ? "bg-cyber-blue/10 text-cyber-blue" : "bg-primary/10 text-primary"
                    }`}>
                      {ep.method}
                    </span>
                    <span className="font-mono text-sm flex-1">{ep.path}</span>
                    <span className="text-xs text-muted-foreground">{ep.type}</span>
                  </motion.div>
                ))}
              </div>

              <div className="mt-8 flex gap-4">
                <Button asChild className="glow-green font-mono">
                  <Link to="/scanner">
                    Run Scanner <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => setStatus("idle")} className="font-mono">
                  Upload Another
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
