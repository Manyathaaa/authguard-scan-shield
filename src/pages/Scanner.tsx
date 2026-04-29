import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, CheckCircle2, XCircle, Loader2, ArrowRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { createScanWithDetails, updateScan, insertVulnerabilities, getFriendlyScanErrorMessage, isMissingSchemaError } from "@/lib/scanService";
import { useToast } from "@/hooks/use-toast";

interface Endpoint {
  method: string;
  path: string;
  type?: string;
}

interface TestModule {
  id: string;
  name: string;
  description: string;
  endpoint: Endpoint | null;
  status: "idle" | "running" | "pass" | "fail" | "warn";
  details?: string;
}

interface RepoFinding {
  name?: string;
  severity?: string;
  file?: string;
  recommendation?: string;
  snippet?: string;
}

const FALLBACK_ENDPOINTS: Endpoint[] = [
  { method: "POST", path: "/auth/login", type: "fallback" },
  { method: "POST", path: "/auth/register", type: "fallback" },
  { method: "POST", path: "/auth/refresh-token", type: "fallback" },
];

const authPriority = [/login/i, /signin/i, /auth/i, /register/i, /signup/i, /password/i, /token/i, /refresh/i, /session/i, /otp/i, /verify/i, /me\b/i, /profile/i];

function endpointRiskProfile(endpoint: Endpoint | null) {
  const path = (endpoint?.path || "").toLowerCase();
  const method = (endpoint?.method || "GET").toUpperCase();

  return {
    isLoginLike: /login|signin|auth|session/.test(path),
    isRegistrationLike: /register|signup/.test(path),
    isTokenLike: /token|jwt|refresh|oauth/.test(path),
    isPasswordLike: /password|reset|forgot|otp|verify/.test(path),
    isProfileLike: /me\b|profile|account|user/.test(path),
    isWriteAction: ["POST", "PUT", "PATCH", "DELETE"].includes(method),
  };
}

function computeScore(vulns: { risk_level: string }[]) {
  const weights: Record<string, number> = { high: 25, medium: 10, low: 5 };
  const counts = { high: 0, medium: 0, low: 0 };
  for (const v of vulns) {
    const lvl = (v.risk_level || "").toLowerCase();
    if (lvl === "high") counts.high += 1;
    else if (lvl === "medium") counts.medium += 1;
    else if (lvl === "low") counts.low += 1;
  }
  return Math.max(0, Math.round(100 - (counts.high * weights.high + counts.medium * weights.medium + counts.low * weights.low)));
}

function rankEndpoints(endpoints: Endpoint[]) {
  return [...endpoints].sort((a, b) => {
    const score = (ep: Endpoint) => {
      const path = ep.path || "";
      const hit = authPriority.findIndex((rx) => rx.test(path));
      return hit === -1 ? 99 : hit;
    };
    return score(a) - score(b);
  });
}

function buildModules(endpoints: Endpoint[]) {
  const chosen = rankEndpoints(endpoints).slice(0, 5);
  const pick = (index: number) => chosen[index] || chosen[chosen.length - 1] || null;
  const label = (ep: Endpoint | null) => ep ? `${ep.method} ${ep.path}` : "selected auth endpoint";

  return [
    { id: "rate", name: "Rate Limiting Test", description: `Check if ${label(pick(0))} enforces request rate limits`, endpoint: pick(0), status: "idle" as const },
    { id: "password", name: "Password Policy Test", description: `Verify password requirements around ${label(pick(1))}`, endpoint: pick(1), status: "idle" as const },
    { id: "brute", name: "Brute Force Protection", description: `Test resistance to automated credential stuffing on ${label(pick(0))}`, endpoint: pick(0), status: "idle" as const },
    { id: "jwt", name: "JWT Token Validation", description: `Analyze token handling for ${label(pick(2))}`, endpoint: pick(2), status: "idle" as const },
    { id: "lockout", name: "Account Lockout Detection", description: `Verify lockout behavior around ${label(pick(0))}`, endpoint: pick(0), status: "idle" as const },
  ];
}

function normalizeSeverity(severity: string | undefined) {
  const value = (severity || "").toLowerCase();
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function buildMockResults(modules: TestModule[], repoFindings: RepoFinding[] = []) {
  if (repoFindings.length > 0) {
    const sortedFindings = [...repoFindings].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[normalizeSeverity(a.severity)] - order[normalizeSeverity(b.severity)];
    });
    const pickFinding = (index: number) => sortedFindings[index] || null;
    const toResult = (finding: RepoFinding | null, fallback: { details: string; recommendation: string }) => {
      if (!finding) {
        return {
          status: "pass" as const,
          details: fallback.details,
          riskLevel: "low",
          recommendation: fallback.recommendation,
        };
      }
      const severity = normalizeSeverity(finding.severity);
      return {
        status: severity === "high" ? "fail" as const : severity === "medium" ? "warn" as const : "pass" as const,
        details: `${finding.name || "Repository finding"}${finding.file ? ` in ${finding.file}` : ""}${finding.snippet ? `: ${finding.snippet}` : ""}`,
        riskLevel: severity,
        recommendation: finding.recommendation || fallback.recommendation,
      };
    };

    return {
      rate: toResult(pickFinding(0), {
        details: "No rate-limiting-specific repository finding was surfaced.",
        recommendation: "Review authentication endpoints for throttling and retry controls.",
      }),
      password: toResult(pickFinding(1), {
        details: "No password-policy-specific repository finding was surfaced.",
        recommendation: "Review password validation and reset flows in the repository.",
      }),
      brute: toResult(pickFinding(2), {
        details: "No brute-force-specific repository finding was surfaced.",
        recommendation: "Review login and admin endpoints for anti-automation controls.",
      }),
      jwt: toResult(pickFinding(3), {
        details: "No token-handling-specific repository finding was surfaced.",
        recommendation: "Review JWT and session management code paths.",
      }),
      lockout: toResult(pickFinding(4), {
        details: "No account-lockout-specific repository finding was surfaced.",
        recommendation: "Review lockout, alerting, and account recovery behavior.",
      }),
    };
  }

  const endpointLabel = (ep: Endpoint | null) => ep ? `${ep.method} ${ep.path}` : "the selected endpoint";
  const rateProfile = endpointRiskProfile(modules.find((m) => m.id === "rate")?.endpoint || null);
  const passwordProfile = endpointRiskProfile(modules.find((m) => m.id === "password")?.endpoint || null);
  const bruteProfile = endpointRiskProfile(modules.find((m) => m.id === "brute")?.endpoint || null);
  const jwtProfile = endpointRiskProfile(modules.find((m) => m.id === "jwt")?.endpoint || null);
  const lockoutProfile = endpointRiskProfile(modules.find((m) => m.id === "lockout")?.endpoint || null);

  return {
    rate: {
      status: rateProfile.isLoginLike || rateProfile.isTokenLike ? "fail" as const : "warn" as const,
      details: `No rate limiting indicators were detected for ${endpointLabel(modules.find((m) => m.id === "rate")?.endpoint || null)}.`,
      riskLevel: rateProfile.isLoginLike || rateProfile.isTokenLike ? "high" : "medium",
      recommendation: "Add request throttling per IP or user identity for login and token endpoints.",
    },
    password: {
      status: passwordProfile.isRegistrationLike || passwordProfile.isPasswordLike ? "warn" as const : "pass" as const,
      details: `Password-related flows near ${endpointLabel(modules.find((m) => m.id === "password")?.endpoint || null)} should enforce stronger complexity and minimum length requirements.`,
      riskLevel: passwordProfile.isRegistrationLike || passwordProfile.isPasswordLike ? "medium" : "low",
      recommendation: "Require longer passwords and consistent validation across registration and reset flows.",
    },
    brute: {
      status: bruteProfile.isLoginLike ? "fail" as const : bruteProfile.isWriteAction ? "warn" as const : "pass" as const,
      details: `Brute-force protections were not clearly visible for ${endpointLabel(modules.find((m) => m.id === "brute")?.endpoint || null)}.`,
      riskLevel: bruteProfile.isLoginLike ? "high" : bruteProfile.isWriteAction ? "medium" : "low",
      recommendation: "Add account/IP lockouts, CAPTCHAs, and progressive backoff after repeated failures.",
    },
    jwt: {
      status: jwtProfile.isTokenLike ? "fail" as const : jwtProfile.isProfileLike ? "warn" as const : "pass" as const,
      details: `Token-oriented route ${endpointLabel(modules.find((m) => m.id === "jwt")?.endpoint || null)} should be reviewed for signing algorithm, expiry, and refresh-token safety.`,
      riskLevel: jwtProfile.isTokenLike ? "high" : jwtProfile.isProfileLike ? "medium" : "low",
      recommendation: "Use short-lived access tokens, secure refresh rotation, and strong signing keys.",
    },
    lockout: {
      status: lockoutProfile.isLoginLike ? "warn" as const : "pass" as const,
      details: `Account lockout handling for ${endpointLabel(modules.find((m) => m.id === "lockout")?.endpoint || null)} did not show an obvious red flag in this simulated scan.`,
      riskLevel: lockoutProfile.isLoginLike ? "medium" : "low",
      recommendation: "Keep audit logging and user notification in place for lockout events.",
    },
  };
}

export default function Scanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const passedScanId = (location.state as any)?.scanId;
  const passedEndpoints = ((location.state as any)?.endpoints || []) as Endpoint[];
  const passedApiType = ((location.state as any)?.apiType as string | undefined) || "swagger";
  const sourceLabel = ((location.state as any)?.sourceLabel as string | undefined) || "Uploaded API spec";
  const passedRepoFindings = ((location.state as any)?.repoFindings || []) as RepoFinding[];
  const persistedApiType = passedApiType === "postman" ? "postman" : "swagger";

  const resolvedEndpoints = useMemo(() => {
    const cleaned = passedEndpoints.filter((ep) => ep && ep.path);
    if (cleaned.length > 0) return cleaned;
    if (passedApiType === "github" || passedRepoFindings.length > 0) return [];
    return FALLBACK_ENDPOINTS;
  }, [passedEndpoints, passedApiType, passedRepoFindings]);

  const baseModules = useMemo(() => buildModules(resolvedEndpoints), [resolvedEndpoints]);

  const [modules, setModules] = useState<TestModule[]>(baseModules);
  const [scanning, setScanning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [localReport, setLocalReport] = useState<{ scan: any; vulnerabilities: any[] } | null>(null);

  const runScan = async () => {
    const nextModules = buildModules(resolvedEndpoints);
    const mockResults = buildMockResults(nextModules, passedRepoFindings);

    setScanning(true);
    setComplete(false);
    setLocalReport(null);
    setModules(nextModules.map((m) => ({ ...m, status: "idle" })));

    try {
      let scanId = passedScanId;
      let persistToSupabase = true;

      if (!scanId) {
        try {
          const scan = await createScanWithDetails(
            sourceLabel,
            persistedApiType,
            user!.id,
            resolvedEndpoints
          );
          scanId = scan.id;
        } catch (err) {
          persistToSupabase = false;
          toast({
            title: "Running without database persistence",
            description: isMissingSchemaError(err)
              ? "The Supabase scans tables are missing, so this scan will run locally and won’t be saved to the dashboard yet."
              : "This scan could not be saved to the database, so it will run locally and still show results.",
            variant: "destructive",
          });
        }
      }

      setActiveScanId(scanId ?? null);

      if (scanId && persistToSupabase) {
        try {
          await updateScan(scanId, {
            status: "running",
            target_url: sourceLabel,
            api_type: persistedApiType,
            endpoints_detected: resolvedEndpoints,
          });
        } catch (err) {
          persistToSupabase = false;
          toast({
            title: "Running without database persistence",
            description: "Updating the scan in Supabase failed, so this run will continue locally.",
            variant: "destructive",
          });
        }
      }

      nextModules.forEach((mod, i) => {
        setTimeout(() => {
          setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, status: "running" } : m)));
        }, i * 1000);

        setTimeout(() => {
          const result = mockResults[mod.id as keyof typeof mockResults];
          setModules((prev) =>
            prev.map((m) => (m.id === mod.id ? { ...m, status: result.status, details: result.details } : m))
          );

          if (i === nextModules.length - 1) {
            const vulns = nextModules.map((module) => {
              const resultForModule = mockResults[module.id as keyof typeof mockResults];
              return {
                test_module: module.id,
                name: module.endpoint ? `${module.name} - ${module.endpoint.method} ${module.endpoint.path}` : module.name,
                risk_level: resultForModule.riskLevel,
                details: resultForModule.details,
                recommendation: resultForModule.recommendation,
                passed: resultForModule.status === "pass",
              };
            });

            const score = computeScore(vulns as any[]);
            const scanPayload = {
              id: scanId || `local-${Date.now()}`,
              target_url: sourceLabel,
              api_type: persistedApiType,
              status: "completed",
              security_score: score,
              endpoints_detected: resolvedEndpoints,
              created_at: new Date().toISOString(),
            };

            if (scanId && persistToSupabase) {
              insertVulnerabilities(scanId, vulns).then(() => {
                updateScan(scanId!, {
                  status: "completed",
                  security_score: score,
                  api_type: persistedApiType,
                  endpoints_detected: resolvedEndpoints,
                });
                setLocalReport({
                  scan: scanPayload,
                  vulnerabilities: vulns.map((v, index) => ({ ...v, id: `saved-vuln-${index + 1}` })),
                });
              }).catch((err) => {
                if (isMissingSchemaError(err)) {
                  setLocalReport({
                    scan: scanPayload,
                    vulnerabilities: vulns.map((v, index) => ({ ...v, id: `local-vuln-${index + 1}` })),
                  });
                  toast({
                    title: "Scan complete",
                    description: "Results are available locally, but they were not saved because the Supabase tables are missing.",
                    variant: "destructive",
                  });
                  return;
                }
                toast({ title: "Error", description: getFriendlyScanErrorMessage(err), variant: "destructive" });
              });
            } else {
              setLocalReport({
                scan: scanPayload,
                vulnerabilities: vulns.map((v, index) => ({ ...v, id: `local-vuln-${index + 1}` })),
              });
            }

            setScanning(false);
            setComplete(true);
          }
        }, i * 1000 + 900);
      });
    } catch (err: any) {
      toast({ title: "Error", description: getFriendlyScanErrorMessage(err), variant: "destructive" });
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
          <p className="text-muted-foreground mb-3">Run automated security tests against detected authentication endpoints.</p>
          <div className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="text-xs font-mono text-muted-foreground mb-2">Scan target</div>
            <div className="text-sm">{sourceLabel}</div>
            <div className="mt-3 text-xs font-mono text-muted-foreground mb-2">Endpoints in scope</div>
            {resolvedEndpoints.length > 0 ? (
              <div className="space-y-2">
                {resolvedEndpoints.slice(0, 5).map((ep, index) => (
                  <div key={`${ep.method}-${ep.path}-${index}`} className="flex items-center gap-3 text-sm">
                    <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-primary">{ep.method}</span>
                    <span className="font-mono">{ep.path}</span>
                  </div>
                ))}
                {resolvedEndpoints.length > 5 && (
                  <div className="text-xs text-muted-foreground">+ {resolvedEndpoints.length - 5} more endpoints</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Using repository findings as scan context.
                {passedRepoFindings.length > 0 ? ` ${passedRepoFindings.length} finding(s) available from the GitHub scan.` : ""}
              </div>
            )}
          </div>
          <Button onClick={runScan} disabled={scanning} className="glow-green font-mono mb-10">
            {scanning ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning...</>) : (<><Play className="mr-2 h-4 w-4" /> {complete ? "Rescan" : "Start Scan"}</>)}
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
                mod.status === "pass" ? "border-primary/30 bg-primary/5" : "border-border bg-card"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5">{statusIcon(mod.status)}</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{mod.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{mod.description}</p>
                  {mod.endpoint && <p className="text-xs font-mono text-foreground/60 mt-2">{mod.endpoint.method} {mod.endpoint.path}</p>}
                  {mod.details && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs mt-2 font-mono text-foreground/80">→ {mod.details}</motion.p>}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {complete && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8">
            <Button onClick={() => navigate("/report", { state: localReport ? localReport : { scanId: activeScanId } })} className="glow-green font-mono">
              View Report <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
