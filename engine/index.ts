import { CONTRACT_VERSION, type Option, type Property, type ScenarioInput, type Stage, type Structure, type StructureNode } from "./schema";
import type { CostRow, EngineResult, Flag, RowInput, Totals } from "./types";
import { ASSUMPTION, fmt } from "./money";
import { SDLT_NONRES_RULE, sdltNonRes } from "./rules/sdlt_nonres";
import { SDLT_RES_RULE, sdltRes } from "./rules/sdlt_res";
import { STAMP_DUTY_SHARES_FLAG, STAMP_DUTY_SHARES_RULE, stampDutyShares } from "./rules/stamp_duty_shares";
import { ATED_FLAG, ATED_RULE, ated } from "./rules/ated";
import { IHT_ENTRY_RULE, ihtEntry } from "./rules/iht_entry";
import { IHT_TEN_YEAR_RULE, ihtTenYear } from "./rules/iht_ten_year";
import { IHT_DEATH_COMPARATOR_RULE, ihtDeathComparator } from "./rules/iht_death_comparator";
import { DEFAULT_SETTLOR_NRB } from "./rules/iht_base";

export { CONTRACT_VERSION } from "./schema";
export { ScenarioInputSchema } from "./schema";
export type * from "./types";

/** Threshold at which a residential purchase is treated as non-residential for SDLT. */
export const NONRES_DWELLING_THRESHOLD = 6;

const SDLT_PRICED_NATIONS = new Set(["england", "ni"]);

const dwellingsOf = (p: Property) => Math.max(1, p.dwellings);
const priceInput = (p: Property): RowInput => ({ label: `${p.name} price`, value: p.price_gbp, source: p.source });

/** Who acquires the properties in this structure: A = investor node, B/C/D = PropCo. */
export function findBuyer(s: Structure): StructureNode {
  const kind = s.option === "A" ? "investor" : "propco";
  const node = s.nodes.find((n) => n.kind === kind) ?? (kind === "propco" ? s.nodes.find((n) => n.id === "spv") : undefined);
  if (!node) throw new Error(`Structure ${s.option}: no ${kind} node to act as buyer`);
  return node;
}

export function isCompany(n: StructureNode): boolean {
  if (n.entity_type) return n.entity_type === "company";
  return n.kind === "propco";
}

export function runEngine(input: ScenarioInput): EngineResult {
  const rows: CostRow[] = [];
  const flags: Flag[] = [];
  const nrb = input.settlor_nrb_available_gbp ?? DEFAULT_SETTLOR_NRB;
  const props = input.properties;
  const packetPrice = props.reduce((s, p) => s + p.price_gbp, 0);
  const allPriceInputs = props.map(priceInput);
  const allIds = props.map((p) => p.id);
  const hasResidential = props.some((p) => p.use === "residential");

  // Scenario-wide flags
  for (const p of props) {
    if (p.nation === "scotland" || p.nation === "wales") {
      const tax = p.nation === "scotland" ? "LBTT" : "LTT";
      flags.push({
        id: `nation:${p.id}`,
        option: null,
        severity: "review",
        message: `${p.name} is in ${p.nation}: ${tax} replaces SDLT there and is not priced in v1.`,
        property_ids: [p.id],
      });
    }
  }

  for (const s of input.structures) {
    const opt = s.option;
    const buyer = findBuyer(s);
    const company = isCompany(buyer);
    const sdltProps = props.filter((p) => SDLT_PRICED_NATIONS.has(p.nation));

    // ---- SDLT (acquire) ----
    const nonResProps = sdltProps.filter((p) => p.use !== "residential");
    const resProps = sdltProps.filter((p) => p.use === "residential");
    const resDwellings = resProps.reduce((n, p) => n + dwellingsOf(p), 0);

    for (const p of nonResProps) {
      const r = sdltNonRes(p.price_gbp);
      rows.push({
        id: `${opt}:SDLT_NONRES:${p.id}`,
        option: opt,
        stage: "acquire",
        tax: "SDLT_NONRES",
        amount_gbp: r.amount,
        formula: `${p.name} (${p.use}): ${r.formula}`,
        inputs: [priceInput(p)],
        rule: SDLT_NONRES_RULE,
        property_ids: [p.id],
        payer_node_id: buyer.id,
      });
    }

    if (resProps.length > 0 && resDwellings >= NONRES_DWELLING_THRESHOLD) {
      const total = resProps.reduce((t, p) => t + p.price_gbp, 0);
      const r = sdltNonRes(total);
      rows.push({
        id: `${opt}:SDLT_NONRES:residential_packet`,
        option: opt,
        stage: "acquire",
        tax: "SDLT_NONRES",
        amount_gbp: r.amount,
        formula: `${resDwellings} dwellings bought in one transaction (${NONRES_DWELLING_THRESHOLD}+ treated as non-residential), on combined price: ${r.formula}`,
        inputs: [
          ...resProps.map(priceInput),
          { label: "Dwellings in transaction", value: resDwellings, source: ASSUMPTION("Sum of property dwellings") },
        ],
        rule: SDLT_NONRES_RULE,
        property_ids: resProps.map((p) => p.id),
        payer_node_id: buyer.id,
      });
    } else {
      for (const p of resProps) {
        const r = sdltRes(p.price_gbp, dwellingsOf(p), company);
        rows.push({
          id: `${opt}:${r.tax}:${p.id}`,
          option: opt,
          stage: "acquire",
          tax: r.tax,
          amount_gbp: r.amount,
          formula: `${p.name}: ${r.formula}`,
          inputs: [
            priceInput(p),
            { label: "Buyer", value: `${buyer.label} (${company ? "company" : "individual"})`, source: ASSUMPTION(`Structure ${opt} buyer node`) },
          ],
          rule: SDLT_RES_RULE,
          property_ids: [p.id],
          payer_node_id: buyer.id,
        });
        if (r.tax === "SDLT_RES_COMPANY_17") {
          flags.push({
            id: `${opt}:sdlt17_relief:${p.id}`,
            option: opt,
            severity: "info",
            message: `${p.name}: property-rental-business relief may disapply the 17% rate (higher rates would then apply).`,
            property_ids: [p.id],
            rule: SDLT_RES_RULE,
          });
        }
      }
    }

    // ---- ATED (hold, annual) ----
    if (company) {
      let anyAted = false;
      for (const p of props.filter((p) => p.use === "residential")) {
        const r = ated(p.price_gbp, dwellingsOf(p));
        if (r.amount === 0) continue;
        anyAted = true;
        rows.push({
          id: `${opt}:ATED:${p.id}`,
          option: opt,
          stage: "hold",
          tax: "ATED",
          amount_gbp: r.amount,
          formula: `${p.name}: ${r.formula}`,
          inputs: [
            priceInput(p),
            { label: "Dwellings", value: dwellingsOf(p), source: p.source },
          ],
          rule: ATED_RULE,
          property_ids: [p.id],
          payer_node_id: buyer.id,
          annual: true,
        });
      }
      if (anyAted) flags.push({ id: `${opt}:ated_relief`, option: opt, severity: "info", message: ATED_FLAG, rule: ATED_RULE });
    }

    // ---- Stamp duty on shares (exit) ----
    if (opt !== "A") {
      const r = stampDutyShares(packetPrice);
      rows.push({
        id: `${opt}:STAMP_DUTY_SHARES:packet`,
        option: opt,
        stage: "exit",
        tax: "STAMP_DUTY_SHARES",
        amount_gbp: r.amount,
        formula: r.formula,
        inputs: allPriceInputs,
        rule: STAMP_DUTY_SHARES_RULE,
        property_ids: allIds,
        payer_node_id: "exit_buyer",
      });
      flags.push({ id: `${opt}:shares_exit`, option: opt, severity: "info", message: STAMP_DUTY_SHARES_FLAG, rule: STAMP_DUTY_SHARES_RULE });
    }

    // ---- Trust IHT (option D) ----
    if (opt === "D") {
      const trust = s.nodes.find((n) => n.kind === "trust") ?? buyer;
      const settlor = s.nodes.find((n) => n.kind === "settlor" || n.kind === "investor") ?? trust;
      const ihtInputs: RowInput[] = [
        ...allPriceInputs,
        {
          label: "Settlor nil-rate band available",
          value: nrb,
          source: input.settlor_nrb_available_gbp !== undefined && input.settlor_nrb_available_gbp !== DEFAULT_SETTLOR_NRB
            ? { kind: "user", label: "Scenario input: settlor_nrb_available_gbp" }
            : ASSUMPTION(`Default nil-rate band £${fmt(DEFAULT_SETTLOR_NRB)}, assumed unused`),
        },
      ];
      const iht: [Stage, CostRow["tax"], ReturnType<typeof ihtEntry>, CostRow["rule"], string, boolean][] = [
        ["acquire", "IHT_ENTRY", ihtEntry(packetPrice, nrb), IHT_ENTRY_RULE, settlor.id, false],
        ["ten_year", "IHT_TEN_YEAR", ihtTenYear(packetPrice, nrb), IHT_TEN_YEAR_RULE, trust.id, false],
        ["death", "IHT_DEATH_COMPARATOR", ihtDeathComparator(packetPrice, nrb), IHT_DEATH_COMPARATOR_RULE, settlor.id, true],
      ];
      for (const [stage, tax, r, rule, payer, comparator] of iht) {
        rows.push({
          id: `${opt}:${tax}:packet`,
          option: opt,
          stage,
          tax,
          amount_gbp: r.amount,
          formula: r.formula,
          inputs: ihtInputs,
          rule,
          property_ids: allIds,
          payer_node_id: payer,
          ...(comparator ? { comparator: true } : {}),
        });
      }
      const d = (id: string, message: string, severity: Flag["severity"] = "review") =>
        flags.push({ id: `D:${id}`, option: "D", severity, message, rule: IHT_ENTRY_RULE });
      d("residence", "The settlor's residence and the post-April 2025 inheritance-tax rules decide whether the trust is in scope.");
      d("nrb_used", "The nil-rate band may already be used by gifts in the last 7 years.");
      d("no_bpr", "Investment property does not qualify for business relief.");
      d("trs", "The trust must be registered on HMRC's Trust Registration Service.", "info");
      if (hasResidential) d("offshore_lookthrough", "UK homes held via an offshore company are looked through for inheritance tax.");
    }

    if (opt === "C") {
      flags.push({
        id: "C:jput_election",
        option: "C",
        severity: "review",
        message:
          "JPUT: make a transparency election (all investors consent, irrevocable) or an exemption election (within 12 months of acquisition).",
      });
    }

    if (opt === "A" && props.length > 1) {
      flags.push({
        id: "A:linked",
        option: "A",
        severity: "info",
        message: "Purchases from the same seller in one deal are linked transactions; SDLT is calculated on the combined price.",
        property_ids: allIds,
        rule: SDLT_NONRES_RULE,
      });
    }
  }

  return { contract_version: CONTRACT_VERSION, rows, flags, totals: computeTotals(rows) };
}

export function computeTotals(rows: CostRow[]): Totals {
  const totals: Totals = {};
  for (const r of rows) {
    const o = (totals[r.option as Option] ??= {});
    o[r.stage] = (o[r.stage] ?? 0) + r.amount_gbp;
  }
  return totals;
}
