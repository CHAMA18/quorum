/**
 * What a gate card states about its subject.
 *
 * A gate that files or signs a contract states the contract value — a
 * contract always has one, so a filing that carries none is marked
 * "VALUE REQUIRED" and held back rather than printed as a dash. A gate that
 * records a bid register states the bids on record; every other gate names
 * the record it acts on. The value parser mirrors the sidecar's
 * `contractValueCheck`, so the card and the server agree on what counts as a
 * stated value.
 */

export type GateInputs = {
  bidder?: string;
  value?: string | number;
  findings?: unknown[];
  bids?: number;
  late?: number;
  [key: string]: unknown;
};

/** Gates that file or sign a contract: the ones that carry a contract value. */
export const CONTRACT_GATES: ReadonlySet<string> = new Set(["file_gate_submission", "sign_contract_pack"]);

/**
 * The contract value a gate states: a number, or a string carrying one
 * ("RWF 2,150,000,000"). Null when there is no positive value to be had.
 */
export function contractValueOf(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const match = String(raw ?? "").match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type GateFact = {
  /** The label above the fact — "CONTRACT VALUE", "BIDS ON RECORD", "RECORD". */
  label: string;
  text: string;
  /** True when a contract-bearing gate states no contract value. */
  missing: boolean;
};

export function gateFact(tool: string, inputs: GateInputs, gateId: string): GateFact {
  if (CONTRACT_GATES.has(tool)) {
    const stated = typeof inputs.value === "string" ? inputs.value.trim() : "";
    const parsed = contractValueOf(inputs.value);
    if (parsed === null) return { label: "CONTRACT VALUE", text: "VALUE REQUIRED", missing: true };
    return { label: "CONTRACT VALUE", text: stated || parsed.toLocaleString("en-US"), missing: false };
  }
  if (tool === "record_bid_opening" || tool === "certify_evaluation") {
    const bids = typeof inputs.bids === "number" ? inputs.bids : undefined;
    const late = typeof inputs.late === "number" && inputs.late > 0 ? inputs.late : undefined;
    const verb = tool === "certify_evaluation" ? "evaluated" : "opened";
    return {
      label: "BIDS ON RECORD",
      text: bids === undefined ? "—" : `${bids} ${verb}${late ? ` · ${late} late` : ""}`,
      missing: false,
    };
  }
  const ref = Object.entries(inputs).find(
    ([key, v]) => !/^(tenderId|runId)$/.test(key) && /(id|sha)$/i.test(key) && typeof v === "string" && v.trim() !== ""
  )?.[1];
  return { label: "RECORD", text: typeof ref === "string" ? ref : gateId, missing: false };
}
