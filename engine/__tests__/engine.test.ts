import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample.json";
import { CONTRACT_VERSION, type OptionId, type Property, type ScenarioInput, type Structure } from "@/contracts";
import { runEngine, ScenarioInputSchema } from "../index";
import { sdltRes } from "../rules/sdlt_res";
import { ated } from "../rules/ated";
import { stampDutyShares } from "../rules/stamp_duty_shares";
import { POST } from "../../app/api/engine/route";

const scenario = ScenarioInputSchema.parse({
  packet: sample.packet,
  structures: sample.structures,
  investors: sample.investors,
});
const golden = sample.expected_engine;

function resProperty(id: string, price: number, extra: Partial<Property> = {}): Property {
  return {
    id, address: `${id}, Somewhere`, postcode: "LU3 3DD", postcode_area: "LU", nation: "england", use: "residential",
    property_type: "house", tenure: "freehold", price_kind: "achieved", rent_pa_gbp: null, yield_pct: null, size_sqft: null,
    dwellings: 1, price_gbp: { value: price, source: { kind: "auction", file: "auction-results.csv", row: 1, record_id: id } },
    ...extra,
  };
}

function scenarioWith(items: Property[], options: OptionId[] = ["B"]): ScenarioInput {
  const propNodes = items.map((p, i) => ({ id: `p${i + 1}`, kind: "property" as const, label: p.id, property_id: p.id }));
  const structures: Structure[] = options.map((option) => {
    const owner = option === "A"
      ? { id: "buyer", kind: "investor" as const, label: "Buyer", investor_type: "uk_company" as const }
      : { id: "spv", kind: "company" as const, label: "PropCo Ltd" };
    const extra = option === "D"
      ? [{ id: "settlor", kind: "investor" as const, label: "Family" }, { id: "trust", kind: "trust" as const, label: "Trust" }]
      : [];
    return {
      option, name: option, rationale: "",
      nodes: [...extra, owner, ...propNodes],
      edges: [
        ...(option === "D" ? [{ from: "settlor", to: "trust", pct: 100 }, { from: "trust", to: "spv", pct: 100 }] : []),
        ...propNodes.map((n) => ({ from: owner.id, to: n.id, pct: 100 })),
      ],
    };
  });
  return {
    packet: { id: "t", seed_id: items[0].id, items, totals: { price_gbp: 0, rent_pa_gbp: 0, blended_yield_pct: null, dwellings: 0 }, match_reason: "" },
    structures, investors: [],
  };
}

describe("golden sample fixture", () => {
  const result = runEngine(scenario);

  it("per-lot SDLT in every option", () => {
    for (const s of scenario.structures) {
      for (const [propertyId, taxes] of Object.entries(golden.per_lot)) {
        const nodeId = s.nodes.find((n) => n.property_id === propertyId)!.id;
        const row = result.rows.find((r) => r.option === s.option && r.tax === "SDLT_NONRES" && r.entity_id === nodeId);
        expect(row?.amount_gbp).toBe(taxes.SDLT_NONRES);
        expect(row?.inputs[0].source.record_id).toBe(propertyId);
      }
    }
  });

  it("per-lot stamp duty on shares figure (0.5% of Wireless House)", () => {
    expect(stampDutyShares(890_000).amount).toBe(golden.per_lot["allsop-6392cf9c"].STAMP_DUTY_SHARES);
  });

  it("totals match exactly", () => {
    for (const o of ["A", "B", "C", "D"] as const) expect(result.totals[o]).toEqual(golden[o]);
  });

  it("D breakdown by tax", () => {
    const d = result.rows.filter((r) => r.option === "D");
    const byTax: Record<string, number> = {};
    for (const r of d) byTax[r.tax] = (byTax[r.tax] ?? 0) + r.amount_gbp;
    expect(byTax).toEqual(golden.D_breakdown);
  });

  it("every row has formula, sourced inputs and RuleRef", () => {
    for (const r of result.rows) {
      expect(r.formula.length).toBeGreaterThan(10);
      expect(r.inputs.length).toBeGreaterThan(0);
      for (const i of r.inputs) expect(i.source.file).toBeTruthy();
      expect(r.rule.citation_url).toMatch(/^https:\/\/www\.gov\.uk\//);
      expect(r.rule.as_of).toBe("2026-27");
      expect(Number.isInteger(r.amount_gbp)).toBe(true);
      expect(scenario.structures.find((s) => s.option === r.option)!.nodes.some((n) => n.id === r.entity_id)).toBe(true);
    }
  });

  it("emits expected flags", () => {
    const has = (o: OptionId, text: string) => result.flags.some((f) => f.option === o && f.message.includes(text));
    expect(has("A", "linked transactions")).toBe(true);
    expect(has("C", "transparency election")).toBe(true);
    expect(has("D", "post-April 2025")).toBe(true);
    expect(has("D", "nil-rate band")).toBe(true);
    expect(has("D", "business relief")).toBe(true);
    expect(has("D", "Trust Registration Service")).toBe(true);
    expect(has("D", "looked through")).toBe(false);
    expect(has("B", "inherits PropCo's history")).toBe(true);
  });

  it("settlor_nrb_available_gbp changes IHT base", () => {
    const r = runEngine({ ...scenario, settlor_nrb_available_gbp: 0 });
    expect(r.totals.D.ten_year).toBe(84_300); // 1,405,000 x 6%
  });
});

describe("residential rules", () => {
  it("£1,100,000 dwelling bought by a company -> SDLT_RES_COMPANY_17 = 187000", () => {
    expect(sdltRes(1_100_000, 1, true)).toMatchObject({ tax: "SDLT_RES_COMPANY_17", amount: golden.residential_checks.company_buys_1100000_dwelling_SDLT_RES_COMPANY_17 });
    const r = runEngine(scenarioWith([resProperty("h", 1_100_000)]));
    const row = r.rows.find((x) => x.stage === "acquire")!;
    expect(row.tax).toBe("SDLT_RES_COMPANY_17");
    expect(row.amount_gbp).toBe(187_000);
    expect(r.flags.some((f) => f.message.includes("property-rental-business relief"))).toBe(true);
  });

  it("£1,100,000 company-held dwelling -> ATED = 9450", () => {
    expect(ated(1_100_000, 1).amount).toBe(golden.residential_checks.ATED_1100000_company_held_2026_27);
    const r = runEngine(scenarioWith([resProperty("h", 1_100_000)]));
    expect(r.totals.B.hold).toBe(9_450);
  });

  it("6-dwelling residential packet -> SDLT_NONRES on the total", () => {
    const items = Array.from({ length: 6 }, (_, i) => resProperty(`h${i}`, 200_000));
    const r = runEngine(scenarioWith(items));
    const acquire = r.rows.filter((x) => x.stage === "acquire");
    expect(acquire).toHaveLength(1);
    expect(acquire[0].tax).toBe("SDLT_NONRES");
    expect(acquire[0].amount_gbp).toBe(49_500); // 1,200,000: 2,000 + 5% x 950,000
    expect(acquire[0].entity_id).toBe("spv");
  });

  it("5 dwellings stay on residential higher rates", () => {
    const items = Array.from({ length: 5 }, (_, i) => resProperty(`h${i}`, 200_000));
    const acquire = runEngine(scenarioWith(items)).rows.filter((x) => x.stage === "acquire");
    expect(acquire).toHaveLength(5);
    expect(acquire.every((x) => x.tax === "SDLT_RES_HIGHER" && x.amount_gbp === 11_500)).toBe(true);
  });

  it("D with residential gets offshore look-through flag", () => {
    const r = runEngine(scenarioWith([resProperty("h", 400_000)], ["D"]));
    expect(r.flags.some((f) => f.option === "D" && f.message.includes("looked through"))).toBe(true);
  });

  it("scotland flagged and not SDLT-priced", () => {
    const r = runEngine(scenarioWith([resProperty("s", 500_000, { nation: "scotland", use: "commercial" })]));
    expect(r.rows.some((x) => x.tax.startsWith("SDLT"))).toBe(false);
    expect(r.flags.some((f) => f.severity === "review" && f.message.includes("LBTT"))).toBe(true);
  });

  it("unpriced property flagged, not costed", () => {
    const r = runEngine(scenarioWith([resProperty("x", 0, { price_gbp: null })]));
    expect(r.rows).toHaveLength(0);
    expect(r.flags.some((f) => f.message.includes("no price"))).toBe(true);
  });
});

describe("stamp duty on shares", () => {
  it("rounds up to nearest £5", () => {
    expect(stampDutyShares(1_405_000).amount).toBe(7_025);
    expect(stampDutyShares(1_000_001).amount).toBe(5_005);
  });
});

describe("POST /api/engine", () => {
  const post = (body: unknown) => POST(new Request("http://x/api/engine", { method: "POST", body: JSON.stringify(body) }));

  it("returns golden totals for the sample fixture", async () => {
    const res = await post({ packet: sample.packet, structures: sample.structures, investors: sample.investors });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract_version).toBe(CONTRACT_VERSION);
    for (const o of ["A", "B", "C", "D"] as const) expect(body.totals[o]).toEqual(golden[o]);
  });

  it("400 with { error } on invalid input", async () => {
    const res = await post({ packet: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });
});
