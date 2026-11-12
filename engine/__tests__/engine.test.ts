import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample.json";
import { CONTRACT_VERSION, type OptionId, type Property, type ScenarioInput, type Structure } from "@/contracts";
import { runEngine, ScenarioInputSchema } from "../index";
import { sdltRes } from "../rules/sdlt_res";
import { ated } from "../rules/ated";
import { stampDutyShares } from "../rules/stamp_duty_shares";
import { POST } from "../../app/api/engine/route";
import { buildA, buildB, buildD, buildStructureTemplates } from "@/agent/structures";
import type { Investor, Packet } from "@/contracts";

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

  it("C sells fund units with no stamp duty; B sells PropCo shares at 0.5%", () => {
    const exit = (o: "B" | "C") => result.rows.filter((r) => r.option === o && r.stage === "exit");
    expect(exit("C")).toMatchObject([{ tax: "STAMP_DUTY_UNITS", amount_gbp: 0, entity_id: "fund" }]);
    expect(exit("C")[0].formula).toContain("Jersey");
    expect(exit("B")).toMatchObject([{ tax: "STAMP_DUTY_SHARES", amount_gbp: 7025 }]);
  });

  it("tax on rent: PropCo pays corporation tax; through the fund the pension's share is exempt", () => {
    const rent = (o: "B" | "C") => result.rows.filter((r) => r.option === o && r.tax === "CORP_TAX_RENT");
    expect(rent("B")).toMatchObject([{ entity_id: "spv", amount_gbp: 14_401 }]);
    expect(rent("C")).toMatchObject([
      { entity_id: "inv1", amount_gbp: 0 },
      { entity_id: "inv2", amount_gbp: 5_206 },
    ]);
    expect(result.flags.some((f) => f.rule_id === "rent_estimate")).toBe(true);
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
      expect(r.rule.citation_url).toMatch(/^https:\/\/www\.(legislation\.)?gov\.uk\//);
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
    expect(r.totals.D.ten_year).toBe(33_720); // trust's 40% of 1,405,000 = 562,000 x 6%
  });
});

describe("option C fund flags", () => {
  it("JPUT election flag only for a JPUT, not a RIF", () => {
    const withFund = (fund_type: "JPUT" | "RIF") => ({
      ...scenario,
      structures: scenario.structures.map((s) =>
        s.option !== "C" ? s : { ...s, nodes: s.nodes.map((n) => (n.kind === "fund" ? { ...n, fund_type, jurisdiction: fund_type === "JPUT" ? ("Jersey" as const) : ("UK" as const) } : n)) },
      ),
    });
    const has = (r: ReturnType<typeof runEngine>) => r.flags.some((f) => f.option === "C" && f.message.includes("transparency election"));
    expect(has(runEngine(withFund("JPUT")))).toBe(true);
    expect(has(runEngine(withFund("RIF")))).toBe(false);
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
    expect(r.rows.filter((x) => x.tax === "ATED").reduce((t, x) => t + x.amount_gbp, 0)).toBe(9_450);
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

describe("non-UK resident SDLT surcharge", () => {
  const home = resProperty("h1", 400_000);
  const nonUkOwner = { id: "buyer", kind: "investor" as const, label: "Family office (non-UK)", investor_type: "family_office_nonuk" as const, jurisdiction: "Other" as const };

  function withOwner(option: OptionId, owner: typeof nonUkOwner | null): ScenarioInput {
    const sc = scenarioWith([home], [option]);
    if (!owner) return sc;
    const s = sc.structures[0];
    if (option === "A") s.nodes = s.nodes.map((n) => (n.id === "buyer" ? owner : n));
    else {
      s.nodes = [owner, ...s.nodes];
      s.edges = [{ from: owner.id, to: "spv", pct: 100 }, ...s.edges];
    }
    return sc;
  }
  const sdltOf = (sc: ScenarioInput) => runEngine(sc).rows.find((r) => r.stage === "acquire" && r.tax.startsWith("SDLT"))!;

  it("adds 2 points to every band for a non-UK direct buyer", () => {
    // Higher rates on £400k = 5%·125k + 7%·125k + 10%·150k = 30,000; +2% on 400k = 8,000
    expect(sdltOf(withOwner("A", nonUkOwner)).amount_gbp).toBe(sdltRes(400_000, 1, false).amount + 8_000);
    expect(sdltOf(withOwner("A", nonUkOwner)).rule.citation_url).toContain("non-uk-residents");
  });

  it("treats a UK PropCo controlled from outside the UK as non-UK", () => {
    expect(sdltOf(withOwner("B", nonUkOwner)).amount_gbp).toBe(sdltRes(400_000, 1, true, true).amount);
    expect(sdltOf(withOwner("B", null)).amount_gbp).toBe(sdltRes(400_000, 1, true, false).amount);
  });

  it("does not surcharge commercial property", () => {
    const shop = resProperty("s1", 400_000, { use: "commercial", dwellings: 0 });
    const sc = scenarioWith([shop], ["A"]);
    sc.structures[0].nodes = sc.structures[0].nodes.map((n) => (n.id === "buyer" ? nonUkOwner : n));
    expect(runEngine(sc).rows.find((r) => r.stage === "acquire")!.tax).toBe("SDLT_NONRES");
  });
});

describe("corporation tax on rent", () => {
  it("19% to £50k, 25% from £250k, marginal relief between", async () => {
    const { corpTax } = await import("../rules/corp_tax");
    expect(corpTax(40_000).amount).toBe(7_600);
    expect(corpTax(300_000).amount).toBe(75_000);
    expect(corpTax(100_000).amount).toBe(22_750); // 25,000 - 150,000 x 3/200
  });
  it("uses stated rent over an estimate", async () => {
    const { rentFor } = await import("../rules/rent");
    const p = resProperty("h", 400_000, { rent_pa_gbp: { value: 30_000, source: { kind: "listing", file: "listings.csv", row: 2 } } });
    expect(rentFor(p, 400_000)).toMatchObject({ value: 30_000, estimated: false });
    expect(rentFor(resProperty("h", 400_000), 400_000)).toMatchObject({ value: 20_000, estimated: true });
  });
});

describe("contract 1.1.0", () => {
  it("accepts assumptions in ScenarioInput", () => {
    const base = { packet: sample.packet, structures: sample.structures, investors: sample.investors };
    expect(ScenarioInputSchema.safeParse({ ...base, assumptions: { rental_relief: true, distribute_profits: true } }).success).toBe(true);
    expect(ScenarioInputSchema.safeParse({ ...base, assumptions: { rental_relief: "yes" } }).success).toBe(false);
  });
});

describe("rental-business relief", () => {
  const ats = (r: ReturnType<typeof runEngine>) => r.rows.filter((x) => x.tax === "ATED");
  it("£1.1m dwelling, company, relief on -> higher rates 108,750 not 17%", () => {
    expect(sdltRes(1_100_000, 1, true, false, true)).toMatchObject({ tax: "SDLT_RES_HIGHER", amount: 108_750 });
    const r = runEngine({ ...scenarioWith([resProperty("h", 1_100_000)]), assumptions: { rental_relief: true } });
    const row = r.rows.find((x) => x.stage === "acquire")!;
    expect(row.tax).toBe("SDLT_RES_HIGHER");
    expect(row.amount_gbp).toBe(108_750);
    expect(row.rule.citation_url).toBe("https://www.gov.uk/guidance/stamp-duty-land-tax-corporate-bodies");
    expect(row.formula).toContain("17% rate disapplied: property-rental-business relief");
  });
  it("ATED row is £0 with relief on, 9,450 with relief off", () => {
    const on = ats(runEngine({ ...scenarioWith([resProperty("h", 1_100_000)]), assumptions: { rental_relief: true } }));
    const off = ats(runEngine(scenarioWith([resProperty("h", 1_100_000)])));
    expect(on.length).toBeGreaterThan(0);
    expect(on.every((x) => x.amount_gbp === 0)).toBe(true);
    expect(on[0].formula).toContain("property-rental-business relief claimed on the yearly return = £0");
    expect(off[0].amount_gbp).toBe(9_450);
  });
  it("relief off reproduces today's golden totals", () => {
    expect(runEngine({ ...scenario, assumptions: { rental_relief: false } }).totals).toEqual(runEngine(scenario).totals);
  });
});

describe("assumptions schema", () => {
  const base = { packet: sample.packet, structures: sample.structures, investors: sample.investors };
  it("rejects a non-boolean distribute_profits", () => {
    expect(ScenarioInputSchema.safeParse({ ...base, assumptions: { distribute_profits: "yes" } }).success).toBe(false);
  });
  it("parses with assumptions omitted", () => {
    expect(ScenarioInputSchema.safeParse(base).success).toBe(true);
  });
});

describe("real investors in A, B and D", () => {
  const packetOf = (items: Property[]): Packet => ({ id: "t", seed_id: items[0].id, items, totals: { price_gbp: 0, rent_pa_gbp: 0, blended_yield_pct: null, dwellings: 0 }, match_reason: "" });
  const run = (items: Property[], investors: Investor[], structures: Structure[]) => runEngine({ packet: packetOf(items), investors, structures });

  it("B with a 60% non-UK family office pays the 2% non-UK surcharge", () => {
    const items = [resProperty("h", 400_000)];
    const inv: Investor[] = [{ type: "family_office_nonuk", label: "Hart FO", pct: 60 }, { type: "uk_pension", label: "Pension", pct: 40 }];
    const row = run(items, inv, [buildB(packetOf(items), inv)]).rows.find((r) => r.stage === "acquire")!;
    expect(row.amount_gbp).toBe(sdltRes(400_000, 1, true, true).amount);
    expect(row.amount_gbp).toBeGreaterThan(sdltRes(400_000, 1, true, false).amount);
  });

  it("A with a UK company and a family office owning half each pays the 17% rate", () => {
    const items = [resProperty("h", 1_100_000)];
    const inv: Investor[] = [{ type: "uk_company", label: "Co", pct: 50 }, { type: "family_office_uk", label: "FO", pct: 50 }];
    const r = run(items, inv, [buildA(packetOf(items), inv)]);
    const row = r.rows.find((x) => x.stage === "acquire")!;
    expect(row).toMatchObject({ tax: "SDLT_RES_COMPANY_17", amount_gbp: 187_000 });
    expect(row.formula).toContain("Co");
    expect(row.formula).toContain("FO");
    // ATED applies because one buyer is a company
    expect(r.rows.some((x) => x.tax === "ATED" && x.amount_gbp === 9_450)).toBe(true);
    // Rent is taxed on each owner's half: two rows
    expect(r.rows.filter((x) => x.tax === "CORP_TAX_RENT").map((x) => x.entity_id)).toEqual(["inv1", "inv2"]);
  });

  it("D with family 70 / pension 30 bases trust IHT on 70% of the packet", () => {
    const items = [resProperty("h", 1_000_000)];
    const inv: Investor[] = [{ type: "family_office_uk", label: "FO", pct: 70 }, { type: "uk_pension", label: "Pension", pct: 30 }];
    const rows = run(items, inv, [buildD(packetOf(items), inv)]).rows;
    const entry = rows.find((x) => x.tax === "IHT_ENTRY")!;
    // (1,000,000 x 70% = 700,000 - 325,000 NRB) x 20% = 75,000
    expect(entry.amount_gbp).toBe(75_000);
    expect(entry.formula).toContain("70%");
    // ten-year: 375,000 x 6% = 22,500; death comparator: 375,000 x 40% = 150,000
    expect(rows.find((x) => x.tax === "IHT_TEN_YEAR")!.amount_gbp).toBe(22_500);
    expect(rows.find((x) => x.tax === "IHT_DEATH_COMPARATOR")!.amount_gbp).toBe(150_000);
  });

  it("investor shares not summing to 100 raise one investor_pct flag per option", () => {
    const items = [resProperty("h", 400_000)];
    const inv: Investor[] = [{ type: "uk_company", label: "Co", pct: 60 }, { type: "uk_pension", label: "Pension", pct: 30 }];
    const flags = run(items, inv, buildStructureTemplates(packetOf(items), inv)).flags.filter((f) => f.rule_id === "investor_pct");
    expect(flags.map((f) => f.option)).toEqual(["A", "B", "C", "D"]);
    expect(flags[0]).toMatchObject({ severity: "review", message: "Investor shares add up to 90%, not 100%." });
  });

  it("D without a family keeps one owner of PropCo and today's D totals", () => {
    const p = structuredClone(sample.packet) as Packet;
    const inv: Investor[] = [{ type: "uk_pension", label: "Pension", pct: 60 }, { type: "uk_company", label: "Co", pct: 40 }];
    const d = buildD(p, inv);
    expect(d.edges.filter((e) => e.to === "spv").reduce((t, e) => t + e.pct, 0)).toBe(100);
    const r = runEngine({ packet: p, investors: inv, structures: [d] });
    expect(r.totals.D).toEqual({ acquire: 265_250, hold: 14_401, exit: 7_025, ten_year: 64_800, death: 432_000 });
    expect(r.flags.some((f) => f.rule_id === "trust_settlor")).toBe(true);
  });

  it("no investors gives today's totals", () => {
    const p = structuredClone(sample.packet) as Packet;
    const t = runEngine({ packet: p, investors: [], structures: buildStructureTemplates(p, []) }).totals;
    expect(t.A).toEqual({ acquire: 49_250, hold: 14_401 });
    expect(t.B).toEqual({ acquire: 49_250, hold: 14_401, exit: 7_025 });
    expect(t.D).toEqual({ acquire: 265_250, hold: 14_401, exit: 7_025, ten_year: 64_800, death: 432_000 });
  });
});
