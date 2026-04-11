import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { SecurityScoreRing } from "@/components/SecurityScoreRing";
import { Activity, ShieldAlert, ShieldCheck, Clock } from "lucide-react";

const scanHistory = [
  { date: "Mar 1", score: 45 },
  { date: "Mar 8", score: 52 },
  { date: "Mar 15", score: 48 },
  { date: "Mar 22", score: 58 },
  { date: "Mar 29", score: 62 },
  { date: "Apr 5", score: 67 },
  { date: "Apr 11", score: 62 },
];

const vulnByType = [
  { name: "Rate Limiting", count: 8 },
  { name: "Password Policy", count: 5 },
  { name: "JWT Issues", count: 7 },
  { name: "Brute Force", count: 3 },
  { name: "Account Lockout", count: 2 },
];

const riskDistribution = [
  { name: "High", value: 35, color: "hsl(0, 72%, 55%)" },
  { name: "Medium", value: 30, color: "hsl(30, 90%, 55%)" },
  { name: "Low", value: 35, color: "hsl(142, 72%, 50%)" },
];

const stats = [
  { label: "Total Scans", value: "24", icon: Activity, color: "text-cyber-blue" },
  { label: "Vulnerabilities", value: "18", icon: ShieldAlert, color: "text-cyber-red" },
  { label: "Fixed Issues", value: "12", icon: ShieldCheck, color: "text-primary" },
  { label: "Last Scan", value: "2h ago", icon: Clock, color: "text-cyber-purple" },
];

export default function Dashboard() {
  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-5 rounded-lg border border-border bg-card"
            >
              <div className="flex items-center gap-3 mb-3">
                <s.icon className={`h-5 w-5 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold font-mono">{s.value}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          {/* Score */}
          <div className="p-6 rounded-lg border border-border bg-card flex flex-col items-center justify-center">
            <p className="text-sm text-muted-foreground mb-4">Current Security Score</p>
            <SecurityScoreRing score={62} />
          </div>

          {/* Score Trend */}
          <div className="lg:col-span-2 p-6 rounded-lg border border-border bg-card">
            <p className="text-sm text-muted-foreground mb-4">Score Trend</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={scanHistory}>
                <XAxis dataKey="date" tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(220, 18%, 10%)", border: "1px solid hsl(215, 20%, 18%)", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="score" stroke="hsl(142, 72%, 50%)" strokeWidth={2} dot={{ r: 4, fill: "hsl(142, 72%, 50%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Vuln by Type */}
          <div className="p-6 rounded-lg border border-border bg-card">
            <p className="text-sm text-muted-foreground mb-4">Vulnerabilities by Type</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={vulnByType}>
                <XAxis dataKey="name" tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(220, 18%, 10%)", border: "1px solid hsl(215, 20%, 18%)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="hsl(200, 80%, 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Risk Distribution */}
          <div className="p-6 rounded-lg border border-border bg-card">
            <p className="text-sm text-muted-foreground mb-4">Risk Distribution</p>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={riskDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                    {riskDistribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(220, 18%, 10%)", border: "1px solid hsl(215, 20%, 18%)", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-6 mt-2">
              {riskDistribution.map((r) => (
                <div key={r.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                  <span className="text-muted-foreground">{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
