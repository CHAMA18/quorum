import { getSetting } from "@/lib/db";

export interface CustomRule {
  id: string;
  name: string;
  keyword: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  enabled: boolean;
}

export const CUSTOM_RULES_KEY = "custom-rules";

export function readRules(): CustomRule[] {
  try {
    const raw = getSetting(CUSTOM_RULES_KEY);
    const parsed = raw ? (JSON.parse(raw) as CustomRule[]) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.keyword === "string") : [];
  } catch {
    return [];
  }
}

/** Count keyword hits of enabled rules in a text corpus. Pure. */
export function ruleMatches(rules: readonly CustomRule[], corpus: string): { rule: CustomRule; matches: number }[] {
  const lower = corpus.toLowerCase();
  return rules.filter((r) => r.enabled).map((rule) => ({ rule, matches: lower.split(rule.keyword.toLowerCase()).length - 1 })).filter((m) => m.matches > 0);
}
