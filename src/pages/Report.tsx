import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle, Download, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecurityScoreRing } from "@/components/SecurityScoreRing";
import { useAuth } from "@/contexts/AuthContext";
import { getLatestScanWithVulnerabilities, getScanVulnerabilities } from "@/lib/scanService";
import { supabase } from "@/integrations/supabase/client";

export default function Report() {
  const { user } = useAuth();
  const location = useLocation();
  const passedScanId = (location.state as any)?.scanId;
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<any>(null);
  const [vulnerabilities, setVulnerabilities] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        if (passedScanId) {
          const { data: scanData } = await supabase.from("scans").select("*").eq("id", passedScanId).single();
          const vulns = await getScanVulnerabilities(passedScanId);
          setScan(scanData);
          setVulnerabilities(vulns || []);
        } else {
          const result = await getLatestScanWithVulnerabilities(user!.id);
          if (result) {
            setScan(result.scan);
            setVulnerabilities(result.vulnerabilities);
          }
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }
    load();
  }, [user, passedScanId]);

  if (loading) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="min-h-screen pt-24 pb-16">
        <div className="container mx-auto px-4 max-w-4xl text-center py-20">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">No Reports Yet</h2>
          <p className="text-muted-foreground">Run a scan first to generate a security report.</p>
        </div>
      </div>
    );
  }

  const score = scan.security_score ?? 0;
  const highCount = vulnerabilities.filter((v) => v.risk_level === "high").length;
  const medCount = vulnerabilities.filter((v) => v.risk_level === "medium").length;
  const lowCount = vulnerabilities.filter((v) => v.risk_level === "low").length;

  const riskIcon = (level: string) => {
    if (level === "high") return XCircle;
    if (level === "medium") return AlertTriangle;
    return CheckCircle2;
  };
  const riskColor = (level: string) => {
    if (level === "high") return "text-cyber-red";
    if (level === "medium") return "text-cyber-orange";
    return "text-primary";
  };
  const riskBg = (level: string) => {
    if (level === "high") return "bg-cyber-red/10";
    if (level === "medium") return "bg-cyber-orange/10";
    return "bg-primary/10";
  };

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-10 flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">Security Report</h1>
              <p className="text-muted-foreground text-sm font-mono">
                Generated {new Date(scan.created_at).toLocaleDateString()} • {scan.target_url}
              </p>
            </div>
            <Button variant="outline" className="font-mono">
              <Download className="mr-2 h-4 w-4" /> Export PDF
            </Button>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <div className="md:col-span-1 flex justify-center">
              <SecurityScoreRing score={score} size={180} />
            </div>
            <div className="md:col-span-2 grid grid-cols-3 gap-4">
              {[
                { label: "High Risk", count: highCount, color: "text-cyber-red" },
                { label: "Medium Risk", count: medCount, color: "text-cyber-orange" },
                { label: "Low Risk", count: lowCount, color: "text-primary" },
              ].map((stat) => (
                <div key={stat.label} className="p-4 rounded-lg border border-border bg-card text-center">
                  <p className={`text-3xl font-bold font-mono ${stat.color}`}>{stat.count}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Findings & Recommendations
          </h2>
          <div className="space-y-4">
            {vulnerabilities.map((v, i) => {
              const Icon = riskIcon(v.risk_level);
              return (
                <motion.div key={v.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="p-5 rounded-lg border border-border bg-card">
                  <div className="flex items-start gap-3">
                    <Icon className={`h-5 w-5 mt-0.5 ${riskColor(v.risk_level)}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h3 className="font-semibold text-sm">{v.name}</h3>
                        <span className={`text-xs font-mono px-2 py-0.5 rounded ${riskBg(v.risk_level)} ${riskColor(v.risk_level)}`}>
                          {v.risk_level.charAt(0).toUpperCase() + v.risk_level.slice(1)}
                        </span>
                        {v.passed && <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary">Passed</span>}
                      </div>
                      {v.details && <p className="text-xs text-muted-foreground mt-1">{v.details}</p>}
                      {v.recommendation && <p className="text-xs text-foreground/70 mt-2 leading-relaxed">{v.recommendation}</p>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
