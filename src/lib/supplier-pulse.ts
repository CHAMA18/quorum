/**
 * The supplier door's audit pulse — public data only.
 *
 * The signed-out supplier page may show that filings arrive and are refused,
 * but never who filed, what they bid, or why a filing failed. This module is
 * the single mapping from the public summary's redacted activity to display
 * rows, so the disclosure rule is testable rather than living only in JSX.
 */

export interface SupplierPulseEntry {
  tool?: string;
  status?: string;
  ts?: string;
}

export interface SupplierPulseRow {
  key: string;
  kind: "received" | "refused" | "enrolled";
  phrase: string;
  detail: string;
  title: string;
  ts: string;
}

function formatTs(ts: string | undefined): string {
  if (!ts || Number.isNaN(Date.parse(ts))) return "";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Map public activity to pulse rows, newest first as the summary supplies it. */
export function supplierPulseRows(
  entries: readonly SupplierPulseEntry[],
  limit = 4,
): SupplierPulseRow[] {
  return entries.slice(0, Math.max(0, limit)).map((entry, index) => {
    const kind: SupplierPulseRow["kind"] =
      entry.tool === "supplier_add"
        ? "enrolled"
        : entry.status === "ERROR"
          ? "refused"
          : "received";
    return {
      key: `${entry.tool ?? "event"}-${entry.ts ?? ""}-${index}`,
      kind,
      phrase:
        kind === "received"
          ? "application received"
          : kind === "refused"
            ? "application refused"
            : "supplier enrolled",
      /* Deliberately empty: the public summary never carries a filer, a bid or
         a refusal reason, and this row must not invent one. */
      detail: "",
      title: "",
      ts: formatTs(entry.ts),
    };
  });
}
