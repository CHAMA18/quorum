/** Tender × category risk heatmap from finding rows. Pure. */

export interface HeatCell {
  tender: string;
  category: string;
  count: number;
  open: number;
  intensity: 0 | 1 | 2 | 3;
}

export function buildHeatmap(rows: readonly { tender: string; cls: string; status: string }[]): { tenders: string[]; categories: string[]; cells: HeatCell[] } {
  const tenders = [...new Set(rows.map((r) => r.tender))].sort();
  const categories = [...new Set(rows.map((r) => r.cls))].sort();
  const cells: HeatCell[] = [];
  for (const tender of tenders) {
    for (const category of categories) {
      const inCell = rows.filter((r) => r.tender === tender && r.cls === category);
      if (!inCell.length) continue;
      const open = inCell.filter((r) => r.status === "OPEN" || r.status === "RE-CHECK").length;
      const intensity = (open >= 4 ? 3 : open >= 2 ? 2 : open >= 1 ? 1 : 0) as HeatCell["intensity"];
      cells.push({ tender, category, count: inCell.length, open, intensity });
    }
  }
  return { tenders, categories, cells };
}

export const HEAT_COLOR: Record<number, string> = { 0: "#e7e3da", 1: "#f2c94c", 2: "#e8833a", 3: "#b52b22" };
