import { supabase } from "@/integrations/supabase/client";

export interface ScanData {
  id: string;
  target_url: string;
  api_type: string;
  status: string;
  security_score: number | null;
  endpoints_detected: any;
  created_at: string;
}

export interface VulnerabilityData {
  id: string;
  scan_id: string;
  test_module: string;
  name: string;
  risk_level: string;
  details: string | null;
  recommendation: string | null;
  passed: boolean;
}

export function isMissingSchemaError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error ?? "");

  return (
    message.includes("Could not find the table 'public.scans'") ||
    message.includes("Could not find the table 'public.vulnerabilities'")
  );
}

export function getFriendlyScanErrorMessage(error: unknown) {
  if (isMissingSchemaError(error)) {
    return "Supabase tables are missing for this project. Run the migration in Supabase SQL Editor or apply the files under supabase/migrations.";
  }

  return error instanceof Error ? error.message : String(error);
}

export async function createScan(targetUrl: string, apiType: string, userId: string) {
  const { data, error } = await supabase
    .from("scans")
    .insert({ target_url: targetUrl, api_type: apiType, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateScan(scanId: string, updates: Partial<ScanData>) {
  const { data, error } = await supabase
    .from("scans")
    .update(updates)
    .eq("id", scanId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUserScans(userId: string) {
  const { data, error } = await supabase
    .from("scans")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function insertVulnerabilities(scanId: string, vulns: Omit<VulnerabilityData, "id" | "scan_id" | "created_at">[]) {
  const rows = vulns.map((v) => ({ ...v, scan_id: scanId }));
  const { error } = await supabase.from("vulnerabilities").insert(rows);
  if (error) throw error;
}

export async function getScanVulnerabilities(scanId: string) {
  const { data, error } = await supabase
    .from("vulnerabilities")
    .select("*")
    .eq("scan_id", scanId);
  if (error) throw error;
  return data;
}

export async function getLatestScanWithVulnerabilities(userId: string) {
  const { data: scans, error } = await supabase
    .from("scans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!scans || scans.length === 0) return null;

  const scan = scans[0];
  const { data: vulns } = await supabase
    .from("vulnerabilities")
    .select("*")
    .eq("scan_id", scan.id);

  return { scan, vulnerabilities: vulns || [] };
}

export async function getDashboardStats(userId: string) {
  const { data: scans } = await supabase
    .from("scans")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const allScans = scans || [];
  const completedScans = allScans.filter((s) => s.status === "completed");

  let totalVulns = 0;
  let fixedCount = 0;
  for (const scan of completedScans) {
    const { data: vulns } = await supabase
      .from("vulnerabilities")
      .select("*")
      .eq("scan_id", scan.id);
    if (vulns) {
      totalVulns += vulns.filter((v) => !v.passed).length;
      fixedCount += vulns.filter((v) => v.passed).length;
    }
  }

  return {
    totalScans: allScans.length,
    totalVulnerabilities: totalVulns,
    fixedIssues: fixedCount,
    latestScore: completedScans[0]?.security_score ?? null,
    scoreTrend: completedScans
      .slice(0, 7)
      .reverse()
      .map((s) => ({
        date: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        score: s.security_score ?? 0,
      })),
  };
}
