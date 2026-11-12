import { describe, expect, it } from "vitest";
import sample from "./fixtures/sample.json";
import { runEngine, ScenarioInputSchema, CONTRACT_VERSION } from "../index";
import type { ScenarioInputRaw } from "../types";
import { sdltRes } from "../rules/sdlt_res";
import { ated } from "../rules/ated";
import { stampDutyShares } from "../rules/stamp_duty_shares";
import { POST } from "../../app/api/engine/route";

const run = (raw: ScenarioInputRaw) => runEngine(ScenarioInputSchema.parse(raw));
const src = { kind: "user" as const, label: "test" };

const companyStructures = (opts: ("A" | "B" | "C" | "D")[] = ["B"]): ScenarioInputRaw["structures"] =>
  opts.map((option) => ({
    option,
    nodes:
      option === "A"
        ? [{ id: "inv", kind: "investor", label: "Investor" }]
        : [{ id: "spv", kind: "propco", label: "PropCo Ltd", entity_type: "company" }],
  }));

describe("golden sample fixture", () => {
  const result = run(sample.scenario as ScenarioInputRaw);

  it("per-lot SDLT", () => {
    for (const opt of ["A", "B", "C", "D"] as const) {
      for (const [pid, amount] of Object.entries(sample.expected_engine.sdlt_by_property)) {
        const row = result.rows.find((r) => r.option === opt && r.tax.startsWith("SDLT") && r.property_ids.includes(pid));
        expect(row?.amount_gbp).toBe(amount);
      }
    }
  });

  it("totals match exactly", () => {
    expect(result.totals).toEqual(sample.expected_engine.totals);
  });

  it("contract_version present", () => {
    expect(result.contract_version).toBe(CONTRACT_VERSION);
  });

  it("every row has formula, sourced inputs and RuleRef", () => {
    expect(result.rows.length).toBeGreaterThan(0);
    for (const r of result.rows) {
      expect(r.formula.length).toBeGreaterThan(10);
      expect(r.inputs.length).toBeGreaterThan(0);
      for (const i of r.inputs) expect(i.source.label).toBeTruthy();
      expect(r.rule.citation_url).toMatch(/^https:\/\//);
      expect(r.rule.as_of).toBe("2026-27");
      expect(Number.isInteger(r.amount_gbp)).toBe(true);
    }
  });

  it("D death row is flagged as comparator", () => {
    const death = result.rows.find((r) => r.tax === "IHT_DEATH_COMPARATOR");
    expect(death?.comparator).toBe(true);
  });

  it("emits expected flags", () => {
    const ids = result.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["A:linked", "C:jput_election", "D:residence", "D:nrb_used", "D:no_bpr", "D:trs", "B:shares_exit"]));
    expect(ids).not.toContain("D:offshore_lookthrough");
  });
});

describe("residential rules", () => {
  it("£1,100,000 dwelling bought by a company -> SDLT_RES_COMPANY_17 = 187000", () => {
    expect(sdltRes(1_100_000, 1, true)).toMatchObject({ tax: "SDLT_RES_COMPANY_17", amount: 187_000 });
    const r = run({
      properties: [{ id: "h", name: "House", use: "residential", price_gbp: 1_100_000, dwellings: 1, source: src }],
      structures: companyStructures(["B"]),
    });
    const row = r.rows.find((x) => x.stage === "acquire")!;
    expect(row.tax).toBe("SDLT_RES_COMPANY_17");
    expect(row.amount_gbp).toBe(187_000);
    expect(r.flags.map((f) => f.id)).toContain("B:sdlt17_relief:h");
  });

  it("£1,100,000 company-held dwelling -> ATED = 9450", () => {
    expect(ated(1_100_000, 1).amount).toBe(9_450);
    const r = run({
      properties: [{ id: "h", name: "House", use: "residential", price_gbp: 1_100_000, dwellings: 1, source: src }],
      structures: companyStructures(["B"]),
    });
    expect(r.totals.B?.hold).toBe(9_450);
    expect(r.rows.find((x) => x.tax === "ATED")?.annual).toBe(true);
  });

  it("6-dwelling residential packet -> SDLT_NONRES on the total", () => {
    const properties = Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`, name: `Flat ${i}`, use: "residential" as const, price_gbp: 200_000, dwellings: 1, source: src,
    }));
    const r = run({ properties, structures: companyStructures(["B"]) });
    const acquire = r.rows.filter((x) => x.stage === "acquire");
    expect(acquire).toHaveLength(1);
    expect(acquire[0].tax).toBe("SDLT_NONRES");
    // 1,200,000: 0 + 2,000 + 5% x 950,000 = 49,500
    expect(acquire[0].amount_gbp).toBe(49_500);
    expect(acquire[0].property_ids).toHaveLength(6);
  });

  it("5 dwellings stay on residential higher rates", () => {
    const properties = Array.from({ length: 5 }, (_, i) => ({
      id: `h${i}`, name: `Flat ${i}`, use: "residential" as const, price_gbp: 200_000, dwellings: 1, source: src,
    }));
    const r = run({ properties, structures: companyStructures(["B"]) });
    const acquire = r.rows.filter((x) => x.stage === "acquire");
    expect(acquire).toHaveLength(5);
    // 200,000 at higher rates: 5% x 125,000 + 7% x 75,000 = 6,250 + 5,250
    expect(acquire.every((x) => x.tax === "SDLT_RES_HIGHER" && x.amount_gbp === 11_500)).toBe(true);
  });

  it("D with residential gets offshore look-through flag", () => {
    const r = run({
      properties: [{ id: "h", name: "House", use: "residential", price_gbp: 400_000, source: src }],
      structures: companyStructures(["D"]),
    });
    expect(r.flags.map((f) => f.id)).toContain("D:offshore_lookthrough");
  });

  it("scotland/wales flagged and not SDLT-priced", () => {
    const r = run({
      properties: [{ id: "s", name: "Glasgow unit", nation: "scotland", use: "commercial", price_gbp: 500_000, source: src }],
      structures: companyStructures(["B"]),
    });
    expect(r.rows.some((x) => x.tax.startsWith("SDLT"))).toBe(false);
    expect(r.flags.some((f) => f.id === "nation:s" && f.severity === "review")).toBe(true);
  });
});

describe("stamp duty on shares", () => {
  it("rounds up to nearest £5", () => {
    expect(stampDutyShares(1_405_000).amount).toBe(7_025);
    expect(stampDutyShares(1_000_001).amount).toBe(5_005);
  });
});

describe("POST /api/engine", () => {
  it("returns golden totals for sample", async () => {
    const res = await POST(new Request("http://x/api/engine", { method: "POST", body: JSON.stringify(sample.scenario) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract_version).toBe(CONTRACT_VERSION);
    expect(body.totals).toEqual(sample.expected_engine.totals);
  });

  it("400 on invalid input", async () => {
    const res = await POST(new Request("http://x/api/engine", { method: "POST", body: JSON.stringify({ properties: [] }) }));
    expect(res.status).toBe(400);
  });
});
