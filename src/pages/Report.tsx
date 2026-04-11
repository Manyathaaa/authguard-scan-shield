import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle, Download, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecurityScoreRing } from "@/components/SecurityScoreRing";

const vulnerabilities = [
  { name: "No Rate Limiting on /login", risk: "High", color: "text-cyber-red", bg: "bg-cyber-red/10", icon: XCircle, recommendation: "Implement rate limiting (e.g., 5 requests/minute per IP) using middleware like express-rate-limit." },
  { name: "Weak Password Policy", risk: "Medium", color: "text-cyber-orange", bg: "bg-cyber-orange/10", icon: AlertTriangle, recommendation: "Enforce minimum 12 characters with uppercase, lowercase, numbers, and special characters." },
  { name: "JWT Weak Secret & Long Expiry", risk: "High", color: "text-cyber-red", bg: "bg-cyber-red/10", icon: XCircle, recommendation: "Use RS256 algorithm, rotate secrets regularly, and set token expiry to 15 minutes." },
  { name: "Brute Force Protection Active", risk: "Low", color: "text-primary", bg: "bg-primary/10", icon: CheckCircle2, recommendation: "Current CAPTCHA implementation is adequate. Consider adding progressive delays." },
  { name: "Account Lockout Configured", risk: "Low", color: "text-primary", bg: "bg-primary/10", icon: CheckCircle2, recommendation: "Lockout policy is solid. Consider notifying users via email on lockout events." },
];

export default function Report() {
  const score = 62;

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-10 flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">Security Report</h1>
              <p className="text-muted-foreground text-sm font-mono">
                Generated {new Date().toLocaleDateString()} • api.example.com
              </p>
            </div>
            <Button variant="outline" className="font-mono">
              <Download className="mr-2 h-4 w-4" /> Export PDF
            </Button>
          </div>

          {/* Score Overview */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <div className="md:col-span-1 flex justify-center">
              <SecurityScoreRing score={score} size={180} />
            </div>
            <div className="md:col-span-2 grid grid-cols-3 gap-4">
              {[
                { label: "High Risk", count: 2, color: "text-cyber-red" },
                { label: "Medium Risk", count: 1, color: "text-cyber-orange" },
                { label: "Low Risk", count: 2, color: "text-primary" },
              ].map((stat) => (
                <div key={stat.label} className="p-4 rounded-lg border border-border bg-card text-center">
                  <p className={`text-3xl font-bold font-mono ${stat.color}`}>{stat.count}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Vulnerability Details */}
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Findings & Recommendations
          </h2>
          <div className="space-y-4">
            {vulnerabilities.map((v, i) => (
              <motion.div
                key={v.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-5 rounded-lg border border-border bg-card"
              >
                <div className="flex items-start gap-3">
                  <v.icon className={`h-5 w-5 mt-0.5 ${v.color}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="font-semibold text-sm">{v.name}</h3>
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${v.bg} ${v.color}`}>
                        {v.risk}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {v.recommendation}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
