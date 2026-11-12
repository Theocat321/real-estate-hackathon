import {
  CONTRACT_VERSION,
  type CostRow,
  type EngineResult,
  type Flag,
  type OptionId,
  type Property,
  type ScenarioInput,
  type SourceRef,
  type Stage,
  type StructNode,
  type Structure,
  type TaxCode,
  type RuleRef,
} from "@/contracts";
import { fmt } from "./money";
import { SDLT_NONRES_RULE, sdltNonRes } from "./rules/sdlt_nonres";
import { SDLT_RES_RULE, sdltRes } from "./rules/sdlt_res";
import { STAMP_DUTY_SHARES_FLAG, STAMP_DUTY_SHARES_RULE, stampDutyShares } from "./rules/stamp_duty_shares";
import { STAMP_DUTY_UNITS_FLAG, STAMP_DUTY_UNITS_RULE, stampDutyUnits } from "./rules/stamp_duty_units";
import { CORP_TAX_RULE, PENSION_EXEMPT_RULE, corpTax } from "./rules/corp_tax";
import { PROFIT_SHARE_OF_RENT, rentFor } from "./rules/rent";
import { ATED_FLAG, ATED_RULE, ATED_THRESHOLD, ated } from "./rules/ated";
import { IHT_ENTRY_RULE, ihtEntry } from "./rules/iht_entry";
import { IHT_TEN_YEAR_RULE, ihtTenYear } from "./rules/iht_ten_year";
import { IHT_DEATH_COMPARATOR_RULE, ihtDeathComparator } from "./rules/iht_death_comparator";
import { DEFAULT_SETTLOR_NRB } from "./rules/iht_base";
import { CITE } from "./rules/citations";

export { ScenarioInputSchema } from "./schema";

/** Residential purchases of this many dwellings or more in one transaction use non-residential SDLT rates. */
export const NONRES_DWELLING_THRESHOLD = 6;
const SDLT_PRICED_NATIONS = new Set(["england", "ni"]);
const OPTIONS: OptionId[] = ["A", "B", "C", "D"];

type Input = CostRow["inputs"][number];
type Priced = Property & { price: number; priceSource: SourceRef; name: string };

export const shortName = (p: Property): string => {
  const parts = p.address.split(",").map((s) => s.trim()).filter(Boolean);
  // "Flat A, 26 King Edward's Road, ..." -> "Flat A, 26 King Edward's Road"
  const unit = /^(flat|apartment|unit|lot|suite|plot|room)\b/i.test(parts[0] ?? "") && parts[1];
  return (unit ? `${parts[0]}, ${parts[1]}` : parts[0]) || p.id;
};
const dwellingsOf = (p: Property) => Math.max(1, p.dwellings);
const priceInput = (p: Priced): Input => ({ label: `${p.name} price`, value: p.price, source: p.priceSource });
const ruleSource = (rule: RuleRef, excerpt: string): SourceRef => ({ kind: "rule", file: `engine/rules/${rule.id}.ts`, url: rule.citation_url, excerpt });
const structureSource = (opt: OptionId, excerpt: string): SourceRef => ({ kind: "user", file: `structures[${opt}]`, excerpt });

/** The node that acquires the properties: owner of the property nodes (A: investor, B/C/D: PropCo). */
export function findBuyer(s: Structure): StructNode {
  const propertyIds = new Set(s.nodes.filter((n) => n.kind === "property").map((n) => n.id));
  const ownerId = s.edges.find((e) => propertyIds.has(e.to))?.from;
  const owner = s.nodes.find((n) => n.id === ownerId);
  if (owner) return owner;
  const fallback = s.nodes.find((n) => n.kind === (s.option === "A" ? "investor" : "company"));
  if (!fallback) throw new Error(`Structure ${s.option}: cannot identify the buyer node`);
  return fallback;
}

/** Company for SDLT and ATED. A unit trust (fund) is treated as a company for both (FA 2003 s101; ATED covers collective investment schemes). */
export const isCompany = (n: StructNode) => n.kind === "company" || n.kind === "fund" || n.investor_type === "uk_company";

/**
 * Who is taxed on the rent, with their share. Companies pay corporation tax themselves; a fund is
 * transparent for income (RIF, or JPUT with a transparency election), so its investors are taxed on their share.
 */
export function rentPayers(s: Structure, nodeId: string, share = 1, seen = new Set<string>()): { node: StructNode; share: number }[] {
  const node = s.nodes.find((n) => n.id === nodeId);
  if (!node || seen.has(nodeId)) return [];
  seen.add(nodeId);
  const owners = s.edges.filter((e) => e.to === nodeId);
  if (node.kind === "fund" && owners.length > 0) return owners.flatMap((e) => rentPayers(s, e.from, (share * e.pct) / 100, seen));
  return [{ node, share }];
}

const isNonUkNode = (n: StructNode) => n.investor_type === "family_office_nonuk" || (n.jurisdiction !== undefined && n.jurisdiction !== "UK");

/**
 * Share (0–1) of a node controlled from outside the UK. Walks up through companies;
 * investors, trusts and funds answer for themselves (trust/fund residence follows their jurisdiction).
 */
export function nonUkShare(s: Structure, nodeId: string, seen = new Set<string>()): number {
  const node = s.nodes.find((n) => n.id === nodeId);
  if (!node || seen.has(nodeId)) return 0;
  seen.add(nodeId);
  if (node.kind !== "company") return isNonUkNode(node) ? 1 : 0;
  const owners = s.edges.filter((e) => e.to === nodeId);
  if (owners.length === 0) return isNonUkNode(node) ? 1 : 0;
  return owners.reduce((sum, e) => sum + (e.pct / 100) * nonUkShare(s, e.from, seen), 0);
}

/** SDLT non-UK test: a non-UK buyer, or a UK company more than half controlled from outside the UK. */
export const buyerIsNonUk = (s: Structure, buyer: StructNode) => nonUkShare(s, buyer.id) > 0.5;

export function runEngine(input: ScenarioInput): EngineResult {
  const rows: CostRow[] = [];
  const flags: Flag[] = [];
  const nrb = input.settlor_nrb_available_gbp ?? DEFAULT_SETTLOR_NRB;

  const priced: Priced[] = input.packet.items
    .filter((p) => p.price_gbp !== null)
    .map((p) => ({ ...p, price: Math.round(p.price_gbp!.value), priceSource: p.price_gbp!.source, name: shortName(p) }));
  const unpriced = input.packet.items.filter((p) => p.price_gbp === null);
  const packetPrice = priced.reduce((s, p) => s + p.price, 0);
  const allPriceInputs = priced.map(priceInput);
  const hasResidential = priced.some((p) => p.use === "residential");

  for (const s of input.structures) {
    const opt = s.option;
    const buyer = findBuyer(s);
    const company = isCompany(buyer);
    const nonUk = buyerIsNonUk(s, buyer);
    const rentalRelief = input.assumptions?.rental_relief ?? false;
    const nodeFor = (p: Property) => s.nodes.find((n) => n.kind === "property" && n.property_id === p.id)?.id ?? buyer.id;
    const spv = s.nodes.find((n) => n.kind === "company") ?? buyer;
    const flag = (f: Omit<Flag, "option">) => flags.push({ option: opt, ...f });
    const row = (stage: Stage, tax: TaxCode, entity_id: string, amount_gbp: number, formula: string, inputs: Input[], rule: RuleRef) =>
      rows.push({ option: opt, stage, entity_id, tax, amount_gbp, formula, inputs, rule });

    // ---- Coverage flags ----
    for (const p of input.packet.items) {
      if (p.nation === "scotland" || p.nation === "wales") {
        flag({
          entity_id: nodeFor(p),
          rule_id: SDLT_NONRES_RULE.id,
          severity: "review",
          message: `${shortName(p)} is in ${p.nation === "scotland" ? "Scotland: LBTT" : "Wales: LTT"} replaces SDLT and is not priced in v1.`,
        });
      }
    }
    for (const p of unpriced) {
      flag({ entity_id: nodeFor(p), rule_id: "engine_input", severity: "review", message: `${shortName(p)} has no price, so it is not costed.` });
    }

    // ---- SDLT (acquire) ----
    const sdltProps = priced.filter((p) => SDLT_PRICED_NATIONS.has(p.nation));
    const resProps = sdltProps.filter((p) => p.use === "residential");
    const resDwellings = resProps.reduce((n, p) => n + dwellingsOf(p), 0);

    for (const p of sdltProps.filter((p) => p.use !== "residential")) {
      const r = sdltNonRes(p.price);
      row("acquire", "SDLT_NONRES", nodeFor(p), r.amount, `${p.name} (${p.use}), bought by ${buyer.label}: ${r.formula}`, [priceInput(p)], SDLT_NONRES_RULE);
    }

    if (resProps.length > 0 && resDwellings >= NONRES_DWELLING_THRESHOLD) {
      const total = resProps.reduce((t, p) => t + p.price, 0);
      const r = sdltNonRes(total);
      row(
        "acquire",
        "SDLT_NONRES",
        buyer.id,
        r.amount,
        `${resDwellings} dwellings bought in one transaction by ${buyer.label} (${NONRES_DWELLING_THRESHOLD}+ treated as non-residential), on combined price: ${r.formula}`,
        [
          ...resProps.map(priceInput),
          { label: "Dwellings in transaction", value: resDwellings, source: ruleSource(SDLT_NONRES_RULE, `Sum of dwellings across ${resProps.length} residential properties`) },
        ],
        SDLT_NONRES_RULE,
      );
    } else {
      for (const p of resProps) {
        const r = sdltRes(p.price, dwellingsOf(p), company, nonUk, rentalRelief);
        row("acquire", r.tax, nodeFor(p), r.amount, `${p.name}, bought by ${buyer.label}: ${r.formula}`, [
          priceInput(p),
          { label: "Buyer", value: `${buyer.label} (${company ? "company" : "not a company"})`, source: structureSource(opt, `buyer node ${buyer.id}`) },
          {
            label: "Buyer residence for SDLT",
            value: nonUk ? "Non-UK (2% surcharge)" : "UK",
            source: { kind: "rule", file: "engine/index.ts#buyerIsNonUk", url: CITE.sdltNonUk, excerpt: "Non-UK buyer, or UK company controlled from outside the UK" },
          },
        ], nonUk ? { ...SDLT_RES_RULE, citation_url: CITE.sdltNonUk } : r.relieved17 ? { ...SDLT_RES_RULE, citation_url: CITE.sdltCorporate } : SDLT_RES_RULE);
        if (r.tax === "SDLT_RES_COMPANY_17" || r.relieved17) {
          flag({
            entity_id: nodeFor(p),
            rule_id: SDLT_RES_RULE.id,
            severity: "info",
            message: rentalRelief
              ? `${p.name}: 17% rate disapplied on the assumption the homes are let to unconnected tenants; relief is withdrawn if that stops within 3 years.`
              : `${p.name}: property-rental-business relief may disapply the 17% rate.`,
            citation_url: SDLT_RES_RULE.citation_url,
          });
        }
      }
    }

    // ---- Investor-specific flags ----
    if (nonUk && resProps.length > 0 && resDwellings < NONRES_DWELLING_THRESHOLD) {
      flag({
        entity_id: buyer.id,
        rule_id: "sdlt_non_uk_surcharge",
        severity: "info",
        message: `${buyer.label} counts as non-UK for SDLT, so homes carry a 2% surcharge.`,
        citation_url: CITE.sdltNonUk,
      });
    }
    const investorNodes = s.nodes.filter((n) => n.kind === "investor");
    if (investorNodes.some((n) => n.investor_type === "family_office_nonuk")) {
      flag({
        entity_id: (investorNodes.find((n) => n.investor_type === "family_office_nonuk") ?? buyer).id,
        rule_id: "nrcgt",
        severity: "info",
        message: "Non-UK investors pay UK tax on gains from UK property, including on selling shares in a property-rich company.",
        citation_url: CITE.nrcgt,
      });
    }
    if (opt === "D" && input.investors.length > 0 && !input.investors.some((i) => i.type === "family_office_uk" || i.type === "family_office_nonuk")) {
      flag({
        entity_id: buyer.id,
        rule_id: "trust_settlor",
        severity: "review",
        message: "A family trust needs a family to settle it. None of these investors is a family, so treat D as illustrative.",
      });
    }

    // ---- ATED (hold, annual) ----
    if (company) {
      let anyAted = false;
      for (const p of priced.filter((p) => p.use === "residential")) {
        if (dwellingsOf(p) === 0 || p.price / dwellingsOf(p) <= ATED_THRESHOLD) continue;
        const r = ated(p.price, dwellingsOf(p), rentalRelief);
        anyAted = true;
        row("hold", "ATED", nodeFor(p), r.amount, `${p.name}, held by ${buyer.label} (annual): ${r.formula}`, [
          priceInput(p),
          { label: "Dwellings", value: dwellingsOf(p), source: p.priceSource },
        ], ATED_RULE);
      }
      if (anyAted) flag({ entity_id: buyer.id, rule_id: ATED_RULE.id, severity: "info", message: ATED_FLAG, citation_url: ATED_RULE.citation_url });
    }

    // ---- Tax on rent (hold, annual) ----
    if (priced.length > 0) {
      const rents = priced.map((p) => ({ p, r: rentFor(p, p.price) }));
      const rent = rents.reduce((t, x) => t + x.r.value, 0);
      const profit = Math.round(rent * PROFIT_SHARE_OF_RENT);
      const rentInputs: Input[] = [
        ...rents.map(({ p, r }) => ({ label: `${p.name} rent a year${r.estimated ? " (estimated)" : ""}`, value: r.value, source: r.source })),
        { label: "Taxable profit share of rent", value: `${PROFIT_SHARE_OF_RENT * 100}%`, source: { kind: "rule" as const, file: "engine/rules/rent.ts", excerpt: "Assumed running costs of 25% of rent; no loan interest" } },
      ];
      for (const { node, share } of rentPayers(s, buyer.id)) {
        const part = Math.round(profit * share);
        const of = share < 1 ? ` (${Math.round(share * 100)}% share via ${buyer.label})` : "";
        const inputs = share < 1 ? [...rentInputs, { label: `${node.label} share`, value: `${Math.round(share * 100)}%`, source: structureSource(opt, `edge into ${buyer.id}`) }] : rentInputs;
        if (node.investor_type === "uk_pension") {
          row("hold", "CORP_TAX_RENT", node.id, 0, `${node.label}${of}: a registered pension scheme pays no tax on £${fmt(part)} rental profit = £0`, inputs, PENSION_EXEMPT_RULE);
          continue;
        }
        const t = corpTax(part);
        const who = node.kind === "investor" && node.investor_type !== "uk_company" ? `${node.label}, taxed as a company` : node.label;
        row("hold", "CORP_TAX_RENT", node.id, t.amount, `${who}${of}, on £${fmt(rent)} rent less 25% costs: ${t.formula}`, inputs, CORP_TAX_RULE);
        if (node.investor_type === "family_office_uk" || node.investor_type === "family_office_nonuk") {
          flag({ entity_id: node.id, rule_id: CORP_TAX_RULE.id, severity: "review", message: `${node.label} is taxed as a company on rent. Individuals or a trust pay income tax instead.`, citation_url: CORP_TAX_RULE.citation_url });
        }
      }
      const est = rents.filter((x) => x.r.estimated).length;
      if (est > 0) {
        flag({
          entity_id: buyer.id,
          rule_id: "rent_estimate",
          severity: "review",
          message: `${est === priced.length ? "All" : `${est} of ${priced.length}`} lots have no rent in the data, so rent is estimated from a typical yield. Enter the real rent on the packet page.`,
        });
      }
    }

    // ---- Exit: a fund sells its units (no stamp duty); otherwise PropCo shares are sold ----
    const fund = s.nodes.find((n) => n.kind === "fund");
    if (opt !== "A" && priced.length > 0 && fund) {
      const r = stampDutyUnits(fund.label, fund.jurisdiction);
      row("exit", "STAMP_DUTY_UNITS", fund.id, r.amount, r.formula, allPriceInputs, STAMP_DUTY_UNITS_RULE);
      flag({ entity_id: fund.id, rule_id: STAMP_DUTY_UNITS_RULE.id, severity: "review", message: STAMP_DUTY_UNITS_FLAG, citation_url: STAMP_DUTY_UNITS_RULE.citation_url });
    } else if (opt !== "A" && priced.length > 0) {
      const r = stampDutyShares(packetPrice);
      row("exit", "STAMP_DUTY_SHARES", spv.id, r.amount, `Sale of ${spv.label} shares: ${r.formula}`, allPriceInputs, STAMP_DUTY_SHARES_RULE);
      flag({ entity_id: spv.id, rule_id: STAMP_DUTY_SHARES_RULE.id, severity: "info", message: STAMP_DUTY_SHARES_FLAG, citation_url: STAMP_DUTY_SHARES_RULE.citation_url });
    }

    // ---- Trust IHT (option D) ----
    if (opt === "D") {
      const trust = s.nodes.find((n) => n.kind === "trust") ?? buyer;
      const settlor = s.edges.map((e) => (e.to === trust.id ? s.nodes.find((n) => n.id === e.from) : undefined)).find(Boolean) ?? trust;
      const nrbSource: SourceRef =
        input.settlor_nrb_available_gbp !== undefined
          ? { kind: "user", file: "scenario.settlor_nrb_available_gbp", excerpt: `Settlor nil-rate band available £${fmt(nrb)}` }
          : ruleSource(IHT_ENTRY_RULE, `Default nil-rate band £${fmt(DEFAULT_SETTLOR_NRB)}, assumed unused by gifts in the last 7 years`);
      const ihtInputs: Input[] = [...allPriceInputs, { label: "Settlor nil-rate band available", value: nrb, source: nrbSource }];

      const e = ihtEntry(packetPrice, nrb);
      row("acquire", "IHT_ENTRY", trust.id, e.amount, `${settlor.label} settles PropCo into ${trust.label}: ${e.formula}`, ihtInputs, IHT_ENTRY_RULE);
      const t = ihtTenYear(packetPrice, nrb);
      row("ten_year", "IHT_TEN_YEAR", trust.id, t.amount, `${trust.label} at each 10-year anniversary: ${t.formula}`, ihtInputs, IHT_TEN_YEAR_RULE);
      const d = ihtDeathComparator(packetPrice, nrb);
      row("death", "IHT_DEATH_COMPARATOR", settlor.id, d.amount, d.formula, ihtInputs, IHT_DEATH_COMPARATOR_RULE);

      const dFlag = (message: string, severity: Flag["severity"] = "review") =>
        flag({ entity_id: trust.id, rule_id: IHT_ENTRY_RULE.id, severity, message, citation_url: IHT_ENTRY_RULE.citation_url });
      dFlag("The settlor's residence and the post-April 2025 inheritance-tax rules decide whether the trust is in scope.");
      dFlag("The nil-rate band may already be used by gifts in the last 7 years.");
      dFlag("Investment property does not qualify for business relief.");
      dFlag("The trust must be registered on HMRC's Trust Registration Service.", "info");
      if (hasResidential) dFlag("UK homes held via an offshore company are looked through for inheritance tax.");
    }

    const fundNode = s.nodes.find((n) => n.kind === "fund");
    // JPUT elections only apply to a Jersey property unit trust; a UK RIF has its own regime.
    if (opt === "C" && fundNode && (fundNode.fund_type === "JPUT" || (!fundNode.fund_type && fundNode.jurisdiction === "Jersey"))) {
      const fund = fundNode;
      flag({
        entity_id: fund.id,
        rule_id: "jput_elections",
        severity: "review",
        message: "The JPUT needs a transparency election (all investors consent, irrevocable) or an exemption election (within 12 months of acquisition).",
      });
    }

    if (opt === "A" && priced.length > 1) {
      flag({
        entity_id: buyer.id,
        rule_id: SDLT_NONRES_RULE.id,
        severity: "info",
        message: "Purchases from the same seller in one deal are linked transactions; SDLT is calculated on the combined price.",
        citation_url: SDLT_NONRES_RULE.citation_url,
      });
    }
  }

  return { contract_version: CONTRACT_VERSION, rows, flags, totals: computeTotals(rows) };
}

/** totals[option][stage] = sum of rows. Stages with no rows are omitted. */
export function computeTotals(rows: CostRow[]): EngineResult["totals"] {
  const totals = Object.fromEntries(OPTIONS.map((o) => [o, {}])) as EngineResult["totals"];
  for (const r of rows) totals[r.option][r.stage] = (totals[r.option][r.stage] ?? 0) + r.amount_gbp;
  return totals;
}
