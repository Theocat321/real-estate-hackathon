import type { Flag } from "@/contracts";

export const NODE_W = 170;
export const NODE_H = 56;
export const BADGE_ROW_H = 18;

/** Node height for dagre: base height plus one 18px row per badge (at NODE_W a label like "Income tax on rent p.a. £12,329" fills a row), so badges never overlap the next rank. */
export function nodeHeight(badges: number): number {
  return NODE_H + BADGE_ROW_H * badges;
}

/** What an edge means, from the kinds of the nodes it joins. */
export function edgeLabel(fromKind: string, toKind: string, pct: number): string {
  if (fromKind === "investor" && toKind === "trust") return "settles";
  if (toKind === "fund") return `units ${pct}%`;
  if (toKind === "company" || toKind === "propco") return `shares ${pct}%`;
  if (toKind === "property") return pct < 100 ? `owns ${pct}%` : "owns";
  return pct < 100 ? `${pct}%` : "";
}

/** "review" if any review flag, "info" if only info flags, else null. */
export function flagMarker(flags: Pick<Flag, "severity">[]): "!" | "i" | null {
  if (flags.length === 0) return null;
  return flags.some((f) => f.severity === "review") ? "!" : "i";
}
