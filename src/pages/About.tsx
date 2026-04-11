import { motion } from "framer-motion";
import { Shield, Lock, AlertTriangle, BookOpen, CheckCircle2 } from "lucide-react";

const owaspPrinciples = [
  "Implement proper credential storage with strong hashing (bcrypt, Argon2)",
  "Enforce multi-factor authentication where possible",
  "Implement proper session management with secure cookie flags",
  "Use account lockout mechanisms to prevent brute force attacks",
  "Validate password strength against known breached password lists",
  "Implement proper rate limiting on all authentication endpoints",
];

export default function About() {
  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container mx-auto px-4 max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-8">About AuthGuard</h1>

          {/* What are auth vulns */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-cyber-orange" />
              <h2 className="text-xl font-bold">What Are Authentication Vulnerabilities?</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Authentication vulnerabilities are security weaknesses in the way applications verify user identities. These flaws can allow attackers to bypass login mechanisms, steal credentials, hijack sessions, or gain unauthorized access to sensitive data. Common issues include weak password policies, missing rate limiting, insecure token handling, and lack of brute force protection.
            </p>
          </section>

          {/* Importance */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="h-6 w-6 text-cyber-blue" />
              <h2 className="text-xl font-bold">Why Secure Authentication Matters</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Authentication is the front door of every web application. A single vulnerability can compromise entire systems, expose user data, and damage trust. According to OWASP, broken authentication consistently ranks in the top 10 web application security risks. Proactive testing is essential to identify and fix weaknesses before attackers exploit them.
            </p>
          </section>

          {/* OWASP */}
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="h-6 w-6 text-cyber-purple" />
              <h2 className="text-xl font-bold">OWASP Authentication Principles</h2>
            </div>
            <div className="space-y-3">
              {owaspPrinciples.map((p, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border"
                >
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-foreground/80">{p}</span>
                </motion.div>
              ))}
            </div>
          </section>

          {/* How AuthGuard Helps */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold">How AuthGuard Helps Developers</h2>
            </div>
            <p className="text-muted-foreground leading-relaxed mb-4">
              AuthGuard automates the detection of authentication vulnerabilities by analyzing your API specifications and running targeted security tests. Simply upload your Swagger or Postman collection, and AuthGuard will:
            </p>
            <ul className="space-y-2 text-sm text-foreground/80">
              {[
                "Discover authentication endpoints automatically",
                "Test for rate limiting, brute force protection, and lockout policies",
                "Analyze JWT token security and password policies",
                "Generate actionable reports with risk levels and fix recommendations",
                "Track security scores over time through the dashboard",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-primary mt-1">▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </motion.div>
      </div>
    </div>
  );
}
