import { useState } from "react";
import { motion } from "framer-motion";
import { Play, CheckCircle2, XCircle, Loader2, ArrowRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface TestModule {
  id: string;
  name: string;
  description: string;
  status: "idle" | "running" | "pass" | "fail" | "warn";
  details?: string;
}

const initialModules: TestModule[] = [
  { id: "rate", name: "Rate Limiting Test", description: "Check if login endpoint enforces request rate limits", status: "idle" },
  { id: "password", name: "Password Policy Test", description: "Verify minimum password complexity requirements", status: "idle" },
  { id: "brute", name: "Brute Force Protection", description: "Test resistance to automated credential stuffing", status: "idle" },
  { id: "jwt", name: "JWT Token Validation", description: "Analyze JWT signing, expiration, and algorithm security", status: "idle" },
  { id: "lockout", name: "Account Lockout Detection", description: "Verify account lockout after failed attempts", status: "idle" },
];

const results: Record<string, { status: "pass" | "fail" | "warn"; details: string }> = {
  rate: { status: "fail", details: "No rate limiting detected — endpoint allows unlimited requests." },
  password: { status: "warn", details: "Minimum 6 chars required. Recommend 12+ with complexity rules." },
  brute: { status: "pass", details: "Brute force protection active — CAPTCHA after 5 failed attempts." },
  jwt: { status: "fail", details: "JWT uses HS256 with weak secret. Token expiry set to 30 days." },
  lockout: { status: "pass", details: "Account locked after 10 failed attempts. Unlock after 15 min." },
};

export default function Scanner() {
  const [modules, setModules] = useState<TestModule[]>(initialModules);
  const [scanning, setScanning] = useState(false);
  const [complete, setComplete] = useState(false);

  const runScan = () => {
    setScanning(true);
    setComplete(false);
    setModules(initialModules.map((m) => ({ ...m, status: "idle" })));

    initialModules.forEach((mod, i) => {
      setTimeout(() => {
        setModules((prev) =>
          prev.map((m) => (m.id === mod.id ? { ...m, status: "running" } : m))
        );
      }, i * 1200);

      setTimeout(() => {
        const r = results[mod.id];
        setModules((prev) =>
          prev.map((m) => (m.id === mod.id ? { ...m, status: r.status, details: r.details } : m))
        );
        if (i === initialModules.length - 1) {
          setScanning(false);
          setComplete(true);
        }
      }, i * 1200 + 1000);
    });
  };

  const statusIcon = (s: TestModule["status"]) => {
    switch (s) {
      case "running": return <Loader2 className="h-5 w-5 text-cyber-blue animate-spin" />;
      case "pass": return <CheckCircle2 className="h-5 w-5 text-primary" />;
      case "fail": return <XCircle className="h-5 w-5 text-cyber-red" />;
      case "warn": return <Shield className="h-5 w-5 text-cyber-yellow" />;
      default: return <div className="h-5 w-5 rounded-full border-2 border-border" />;
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-2">Vulnerability Scanner</h1>
          <p className="text-muted-foreground mb-8">
            Run automated security tests against detected authentication endpoints.
          </p>

          <Button onClick={runScan} disabled={scanning} className="glow-green font-mono mb-10">
            {scanning ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning...</>
            ) : (
              <><Play className="mr-2 h-4 w-4" /> {complete ? "Rescan" : "Start Scan"}</>
            )}
          </Button>
        </motion.div>

        <div className="space-y-4">
          {modules.map((mod, i) => (
            <motion.div
              key={mod.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`p-5 rounded-lg border transition-colors ${
                mod.status === "fail" ? "border-cyber-red/30 bg-cyber-red/5" :
                mod.status === "warn" ? "border-cyber-yellow/30 bg-cyber-yellow/5" :
                mod.status === "pass" ? "border-primary/30 bg-primary/5" :
                "border-border bg-card"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5">{statusIcon(mod.status)}</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{mod.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{mod.description}</p>
                  {mod.details && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs mt-2 font-mono text-foreground/80"
                    >
                      → {mod.details}
                    </motion.p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {complete && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8">
            <Button asChild className="glow-green font-mono">
              <Link to="/report">
                View Report <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
