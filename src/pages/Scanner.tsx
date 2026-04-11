import { useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, CheckCircle2, XCircle, Loader2, ArrowRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { createScan, updateScan, insertVulnerabilities } from "@/lib/scanService";
import { useToast } from "@/hooks/use-toast";

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

const mockResults: Record<string, { status: "pass" | "fail" | "warn"; details: string; riskLevel: string; recommendation: string }> = {
  rate: { status: "fail", details: "No rate limiting detected — endpoint allows unlimited requests.", riskLevel: "high", recommendation: "Implement rate limiting (e.g., 5 requests/minute per IP) using middleware like express-rate-limit." },
  password: { status: "warn", details: "Minimum 6 chars required. Recommend 12+ with complexity rules.", riskLevel: "medium", recommendation: "Enforce minimum 12 characters with uppercase, lowercase, numbers, and special characters." },
  brute: { status: "pass", details: "Brute force protection active — CAPTCHA after 5 failed attempts.", riskLevel: "low", recommendation: "Current CAPTCHA implementation is adequate. Consider adding progressive delays." },
  jwt: { status: "fail", details: "JWT uses HS256 with weak secret. Token expiry set to 30 days.", riskLevel: "high", recommendation: "Use RS256 algorithm, rotate secrets regularly, and set token expiry to 15 minutes." },
  lockout: { status: "pass", details: "Account locked after 10 failed attempts. Unlock after 15 min.", riskLevel: "low", recommendation: "Lockout policy is solid. Consider notifying users via email on lockout events." },
};

export default function Scanner() {
  const [modules, setModules] = useState<TestModule[]>(initialModules);
  const [scanning, setScanning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const passedScanId = (location.state as any)?.scanId;

  const runScan = async () => {
    setScanning(true);
    setComplete(false);
    setModules(initialModules.map((m) => ({ ...m, status: "idle" })));

    try {
      let scanId = passedScanId;
      if (!scanId) {
        const scan = await createScan("api.example.com", "swagger", user!.id);
        scanId = scan.id;
      }
      setActiveScanId(scanId);
      await updateScan(scanId, { status: "running" });

      initialModules.forEach((mod, i) => {
        setTimeout(() => {
          setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, status: "running" } : m)));
        }, i * 1200);

        setTimeout(() => {
          const r = mockResults[mod.id];
          setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, status: r.status, details: r.details } : m)));

          if (i === initialModules.length - 1) {
            // Save to DB
            const vulns = Object.entries(mockResults).map(([key, val]) => ({
              test_module: key,
              name: initialModules.find((m) => m.id === key)!.name,
              risk_level: val.riskLevel,
              details: val.details,
              recommendation: val.recommendation,
              passed: val.status === "pass",
            }));

            insertVulnerabilities(scanId, vulns).then(() => {
              const highCount = vulns.filter((v) => v.risk_level === "high").length;
              const medCount = vulns.filter((v) => v.risk_level === "medium").length;
              const score = Math.max(0, 100 - highCount * 20 - medCount * 10);
              updateScan(scanId, { status: "completed", security_score: score });
            });

            setScanning(false);
            setComplete(true);
          }
        }, i * 1200 + 1000);
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setScanning(false);
    }
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
          <p className="text-muted-foreground mb-8">Run automated security tests against detected authentication endpoints.</p>
          <Button onClick={runScan} disabled={scanning} className="glow-green font-mono mb-10">
            {scanning ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning...</>) : (<><Play className="mr-2 h-4 w-4" /> {complete ? "Rescan" : "Start Scan"}</>)}
          </Button>
        </motion.div>

        <div className="space-y-4">
          {modules.map((mod, i) => (
            <motion.div key={mod.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              className={`p-5 rounded-lg border transition-colors ${
                mod.status === "fail" ? "border-cyber-red/30 bg-cyber-red/5" :
                mod.status === "warn" ? "border-cyber-yellow/30 bg-cyber-yellow/5" :
                mod.status === "pass" ? "border-primary/30 bg-primary/5" : "border-border bg-card"
              }`}>
              <div className="flex items-start gap-4">
                <div className="mt-0.5">{statusIcon(mod.status)}</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{mod.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{mod.description}</p>
                  {mod.details && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs mt-2 font-mono text-foreground/80">→ {mod.details}</motion.p>}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {complete && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8">
            <Button onClick={() => navigate("/report", { state: { scanId: activeScanId } })} className="glow-green font-mono">
              View Report <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
