import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { SecurityScoreRing } from "@/components/SecurityScoreRing";
import { Activity, ShieldAlert, ShieldCheck, Clock, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getDashboardStats } from "@/lib/scanService";
import { supabase } from "@/integrations/supabase/client";

const riskDistribution = [
  { name: "High", value: 35, color: "hsl(0, 72%, 55%)" },
  { name: "Medium", value: 30, color: "hsl(30, 90%, 55%)" },
  { name: "Low", value: 35, color: "hsl(142, 72%, 50%)" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [vulnByType, setVulnByType] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      if (!user) return;
      setLoading(true);
      try {
        const dashStats = await getDashboardStats(user.id);
        setStats(dashStats);

        // Get vuln breakdown
        const { data: scans } = await supabase.from("scans").select("id").eq("user_id", user.id).eq("status", "completed");
        if (scans && scans.length > 0) {
          const scanIds = scans.map((s) => s.id);
          const { data: vulns } = await supabase.from("vulnerabilities").select("*").in("scan_id", scanIds);
          if (vulns) {
            const byModule: Record<string, number> = {};
            vulns.forEach((v) => {
              byModule[v.name] = (byModule[v.name] || 0) + 1;
            });
            setVulnByType(Object.entries(byModule).map(([name, count]) => ({ name: name.replace(" Test", ""), count })));
          }
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }
    load();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: "Total Scans", value: stats?.totalScans ?? 0, icon: Activity, color: "text-cyber-blue" },
    { label: "Vulnerabilities", value: stats?.totalVulnerabilities ?? 0, icon: ShieldAlert, color: "text-cyber-red" },
    { label: "Fixed Issues", value: stats?.fixedIssues ?? 0, icon: ShieldCheck, color: "text-primary" },
    { label: "Latest Score", value: stats?.latestScore !== null ? `${stats.latestScore}/100` : "N/A", icon: Clock, color: "text-cyber-purple" },
  ];

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="p-5 rounded-lg border border-border bg-card">
              <div className="flex items-center gap-3 mb-3">
                <s.icon className={`h-5 w-5 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-2xl font-bold font-mono">{s.value}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          <div className="p-6 rounded-lg border border-border bg-card flex flex-col items-center justify-center">
            <p className="text-sm text-muted-foreground mb-4">Current Security Score</p>
            <SecurityScoreRing score={stats?.latestScore ?? 0} />
          </div>

          <div className="lg:col-span-2 p-6 rounded-lg border border-border bg-card">
            <p className="text-sm text-muted-foreground mb-4">Score Trend</p>
            {stats?.scoreTrend?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={stats.scoreTrend}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(220, 18%, 10%)", border: "1px solid hsl(215, 20%, 18%)", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="score" stroke="hsl(142, 72%, 50%)" strokeWidth={2} dot={{ r: 4, fill: "hsl(142, 72%, 50%)" }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                No scan data yet. Run your first scan to see trends.
              </div>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-lg border border-border bg-card">
            <p className="text-sm text-muted-foreground mb-4">Vulnerabilities by Type</p>
            {vulnByType.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={vulnByType}>
                  <XAxis dataKey="name" tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(220, 18%, 10%)", border: "1px solid hsl(215, 20%, 18%)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(200, 80%, 55%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            )}
          </div>

          <div className="p-6 rounded-lg border border-border bg-card">
            <p className="text-sm text-muted-foreground mb-4">Risk Distribution</p>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={riskDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                    {riskDistribution.map((entry) => (<Cell key={entry.name} fill={entry.color} />))}
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
