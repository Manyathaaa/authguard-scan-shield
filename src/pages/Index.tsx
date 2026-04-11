import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Zap, Lock, Key, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  { icon: Zap, title: "Rate Limiting Detection", desc: "Test API endpoints for proper rate limiting to prevent brute force attacks." },
  { icon: Lock, title: "Password Strength Validation", desc: "Verify password policies meet modern security standards." },
  { icon: AlertTriangle, title: "Account Lockout Verification", desc: "Check if accounts are properly locked after failed login attempts." },
  { icon: Key, title: "JWT Token Security Analysis", desc: "Analyze JWT tokens for common vulnerabilities and misconfigurations." },
];

const Index = () => {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden cyber-grid">
        <div className="absolute inset-0 scan-line pointer-events-none" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-cyber-blue/5 rounded-full blur-[100px]" />

        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-mono mb-6">
              <ShieldCheck className="h-3.5 w-3.5" />
              AUTHENTICATION SECURITY PLATFORM
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6">
              <span className="text-foreground">Auth</span>
              <span className="text-primary glow-green-text">Guard</span>
              <span className="block text-xl md:text-2xl font-medium text-muted-foreground mt-3">
                Intelligent Authentication Vulnerability Detection System
              </span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mb-8 leading-relaxed">
              Analyze authentication mechanisms in web applications. Detect vulnerabilities before attackers do. Secure your APIs with automated scanning.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button asChild size="lg" className="glow-green font-mono">
                <Link to="/upload">
                  Start Scan <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-border font-mono">
                <Link to="/about">Learn More</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl font-bold mb-4">Security Test Modules</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Comprehensive vulnerability detection across every authentication layer.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group p-6 rounded-lg border border-border bg-card hover:border-primary/40 transition-all duration-300"
              >
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:glow-green transition-shadow">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Terminal Preview */}
      <section className="py-16">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/50">
              <div className="w-3 h-3 rounded-full bg-cyber-red/60" />
              <div className="w-3 h-3 rounded-full bg-cyber-yellow/60" />
              <div className="w-3 h-3 rounded-full bg-primary/60" />
              <span className="ml-2 text-xs text-muted-foreground font-mono">authguard-scanner</span>
            </div>
            <div className="p-6 font-mono text-sm space-y-2">
              <p className="text-primary">$ authguard scan --target api.example.com</p>
              <p className="text-muted-foreground">[INFO] Initializing scanner...</p>
              <p className="text-muted-foreground">[INFO] Discovered 4 auth endpoints</p>
              <p className="text-cyber-yellow">[WARN] Rate limiting not detected on /login</p>
              <p className="text-cyber-red">[VULN] Weak password policy on /register</p>
              <p className="text-primary">[DONE] Scan complete — Score: 62/100</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
