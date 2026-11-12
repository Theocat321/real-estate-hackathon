/**
 * Option A–D ownership structures, built by deterministic template functions (never the LLM),
 * matching the node/edge shape of fixtures/sample.json.
 * Grok only writes each structure's `rationale` (max 2 sentences, no numbers); on any failure
 * we fall back to fixed template text, so /api/structures always answers.
 *
 * Node ids: properties p1..pn (packet order), PropCo "spv", owner in A/B "buyer",
 * C investors inv1..invk + "fund", D "settlor" + "trust".
 */
import { z } from "zod";
import type { Investor, InvestorType, OptionId, Packet, Property, StructEdge, StructNode, Structure } from "./contract";
import { OPTIONS } from "./contract";
import { grokJson, type Transport } from "./grok";

export const OPTION_NAMES: Record<OptionId, string> = {
  A: "Buy each property directly",
  B: "One UK SPV owns the portfolio",
  C: "Fund (unit trust) owns the SPV",
  D: "Family trust owns the SPV",
};

export const FALLBACK_RATIONALE: Record<OptionId, string> = {
  A: "The buyer owns each building outright. Simplest, but stamp duty land tax is paid on every purchase and every later sale is an asset sale.",
  B: "PropCo Ltd buys the buildings once, so a later sale can be of PropCo's shares instead of each building, but the buyer inherits PropCo's history.",
  C: "A fund pools the investors above PropCo, and gains are taxed by investor type, which suits a mixed investor base.",
  D: "A discretionary trust holds PropCo for the family: an inheritance-tax entry charge now in exchange for keeping the portfolio out of the family's estates.",
};

export function isUkInvestor(t: InvestorType): boolean {
  return t !== "family_office_nonuk";
}

function jurisdictionOf(t: InvestorType): "UK" | "Other" {
  return isUkInvestor(t) ? "UK" : "Other";
}

function propertyNodes(packet: Packet): StructNode[] {
  return packet.items.map((p, i) => ({ id: `p${i + 1}`, kind: "property", label: shortLabel(p), property_id: p.id }));
}

/** "Wireless House, Westfield Industrial Estate, ..." -> "Wireless House" */
export function shortLabel(p: Property): string {
  const parts = p.address.split(",").map((s) => s.trim()).filter(Boolean);
  // "Flat A, 26 King Edward's Road, ..." -> "Flat A, 26 King Edward's Road"
  const unit = /^(flat|apartment|unit|lot|suite|plot|room)\b/i.test(parts[0] ?? "") && parts[1];
  return (unit ? `${parts[0]}, ${parts[1]}` : parts[0]) || p.id;
}

function ownsEach(from: string, props: StructNode[]): StructEdge[] {
  return props.map((p) => ({ from, to: p.id, pct: 100 }));
}

const BUYER: StructNode = { id: "buyer", kind: "investor", label: "Buyer", jurisdiction: "UK", investor_type: "uk_company" };
const SPV: StructNode = { id: "spv", kind: "company", label: "PropCo Ltd", jurisdiction: "UK" };

/** A single investor buys in its own name; several investors buy through a generic UK buyer company. */
export function buyerFor(investors: Investor[] = []): StructNode {
  if (investors.length !== 1) return { ...BUYER };
  const inv = investors[0];
  return { id: BUYER.id, kind: "investor", label: inv.label, investor_type: inv.type, jurisdiction: jurisdictionOf(inv.type) };
}

export function buildA(packet: Packet, investors: Investor[] = []): Structure {
  const props = propertyNodes(packet);
  const buyer = buyerFor(investors);
  return { option: "A", name: OPTION_NAMES.A, rationale: "", nodes: [buyer, ...props], edges: ownsEach(buyer.id, props) };
}

export function buildB(packet: Packet, investors: Investor[] = []): Structure {
  const props = propertyNodes(packet);
  const buyer = buyerFor(investors);
  return {
    option: "B",
    name: OPTION_NAMES.B,
    rationale: "",
    nodes: [buyer, { ...SPV }, ...props],
    edges: [{ from: buyer.id, to: SPV.id, pct: 100 }, ...ownsEach(SPV.id, props)],
  };
}

/** JPUT by default; RIF if every investor is UK. */
export function fundTypeFor(investors: Investor[]): "JPUT" | "RIF" {
  return investors.length > 0 && investors.every((i) => isUkInvestor(i.type)) ? "RIF" : "JPUT";
}

export function buildC(packet: Packet, investors: Investor[]): Structure {
  const props = propertyNodes(packet);
  const fund_type = fundTypeFor(investors);
  const fund: StructNode =
    fund_type === "RIF"
      ? { id: "fund", kind: "fund", label: "RIF", fund_type, jurisdiction: "UK" }
      : { id: "fund", kind: "fund", label: "JPUT", fund_type, jurisdiction: "Jersey" };
  const invs: Investor[] = investors.length > 0 ? investors : [{ type: "uk_company", label: "Investor", pct: 100 }];
  const invNodes: StructNode[] = invs.map((inv, i) => ({
    id: `inv${i + 1}`,
    kind: "investor",
    label: inv.label,
    investor_type: inv.type,
    jurisdiction: jurisdictionOf(inv.type),
  }));
  return {
    option: "C",
    name: OPTION_NAMES.C,
    rationale: "",
    nodes: [...invNodes, fund, { ...SPV }, ...props],
    edges: [...invNodes.map((n, i) => ({ from: n.id, to: fund.id, pct: invs[i].pct })), { from: fund.id, to: SPV.id, pct: 100 }, ...ownsEach(SPV.id, props)],
  };
}

export function buildD(packet: Packet, investors: Investor[]): Structure {
  const props = propertyNodes(packet);
  const fo = investors.find((i) => i.type === "family_office_uk" || i.type === "family_office_nonuk");
  const settlor: StructNode = fo
    ? { id: "settlor", kind: "investor", label: `${fo.label} (settlor)`, investor_type: fo.type, jurisdiction: jurisdictionOf(fo.type) }
    : { id: "settlor", kind: "investor", label: "Family (settlor)", investor_type: "family_office_uk", jurisdiction: "UK" };
  const trust: StructNode = { id: "trust", kind: "trust", label: "Discretionary trust", trust_type: "discretionary", jurisdiction: "UK" };
  return {
    option: "D",
    name: OPTION_NAMES.D,
    rationale: "",
    nodes: [settlor, trust, { ...SPV }, ...props],
    edges: [{ from: settlor.id, to: trust.id, pct: 100 }, { from: trust.id, to: SPV.id, pct: 100 }, ...ownsEach(SPV.id, props)],
  };
}

/** Pure, deterministic A, B, C, D (in that order) with fallback rationales. */
export function buildStructureTemplates(packet: Packet, investors: Investor[]): Structure[] {
  const s = [buildA(packet, investors), buildB(packet, investors), buildC(packet, investors), buildD(packet, investors)];
  for (const st of s) st.rationale = FALLBACK_RATIONALE[st.option];
  return s;
}

// ---------------------------------------------------------------------------
// Grok rationale (text only)

const Rationale = z
  .string()
  .min(10)
  .max(400)
  .refine((s) => !/\d/.test(s), "must not contain numbers")
  .refine((s) => (s.match(/[.!?](\s|$)/g) ?? []).length <= 2, "max 2 sentences");

export const RationaleSchema = z.object({ A: Rationale, B: Rationale, C: Rationale, D: Rationale });

const RATIONALE_SYSTEM = `You write short rationales for UK property ownership structure options shown to an investment committee.
Rules: each rationale is at most 2 sentences, plain English, and contains NO numbers, digits, percentages or money amounts.
Never state tax amounts or rates. Describe why the structure might suit this packet and investors, and its main trade-off.
Return JSON: {"A": string, "B": string, "C": string, "D": string}.`;

export function rationalePrompt(packet: Packet, investors: Investor[], structures: Structure[]): string {
  // Deliberately no prices: the rationale must never carry numbers, and fewer inputs = more cache hits.
  const uses = [...new Set(packet.items.map((p) => `${p.use} ${p.property_type} in ${p.nation}`))];
  return [
    `Packet: ${packet.items.length} properties; ${uses.join("; ")}.`,
    `Contains residential dwellings: ${packet.items.some((p) => p.use !== "commercial") ? "yes" : "no"}.`,
    `Investors: ${investors.length ? investors.map((i) => i.label).join(", ") : "unspecified"}.`,
    ...structures.map((s) => `Option ${s.option}: ${s.name}. Chain: ${s.nodes.filter((n) => n.kind !== "property").map((n) => n.label).join(" -> ")} -> properties.`),
  ].join("\n");
}

export async function buildStructures(packet: Packet, investors: Investor[], transport?: Transport): Promise<{ structures: Structure[]; warnings: string[] }> {
  const structures = buildStructureTemplates(packet, investors);
  const warnings: string[] = [];
  try {
    const r = await grokJson(
      { task: "structure-rationale", system: RATIONALE_SYSTEM, user: rationalePrompt(packet, investors, structures), schema: RationaleSchema },
      transport,
    );
    for (const s of structures) s.rationale = r[s.option].trim();
  } catch (e) {
    warnings.push(`Grok rationale unavailable, using template text (${(e as Error).message})`);
  }
  return { structures: OPTIONS.map((o) => structures.find((s) => s.option === o)!), warnings };
}
