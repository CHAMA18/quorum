/**
 * Prompt-injection screening for untrusted bid text (Next-layer upload path).
 *
 * Bid documents are untrusted input to any model call. This screen is
 * fail-closed: on any error or hit, the caller must not pass the raw text to
 * a model as instruction. It mirrors the sidecar engine's R-PROMPT-INJECTION
 * rule so the upload path and the review path agree.
 */

export interface InjectionHit { label: string; severity: "HIGH" | "MEDIUM" }

const PATTERNS: Array<{ re: RegExp; severity: InjectionHit["severity"]; label: string }> = [
  { re: /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i, severity: "HIGH", label: "ignore-previous-instructions" },
  { re: /\bdisregard\s+(?:all\s+)?(?:previous|prior|above|the)\s+(?:instructions?|prompts?|rules?)/i, severity: "HIGH", label: "disregard-instructions" },
  { re: /\byou\s+are\s+now\s+(?:a|an|the)\b/i, severity: "MEDIUM", label: "role-reassignment" },
  { re: /\bsystem\s*prompt\b/i, severity: "MEDIUM", label: "system-prompt-reference" },
  { re: /\b(?:award|give|grant)\s+(?:this|the)\s+(?:bid|tender|contract)\s+to\b/i, severity: "HIGH", label: "outcome-instruction" },
];

export function screenForInjection(text: unknown): { clean: boolean; hits: InjectionHit[] } {
  if (typeof text !== "string") return { clean: false, hits: [{ label: "non-text-input", severity: "HIGH" }] };
  try {
    const hits = PATTERNS.filter((p) => p.re.test(text)).map((p) => ({ label: p.label, severity: p.severity }));
    return { clean: hits.length === 0, hits };
  } catch {
    return { clean: false, hits: [{ label: "screen-error", severity: "HIGH" }] };
  }
}
