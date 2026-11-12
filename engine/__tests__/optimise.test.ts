import { describe, expect, it } from "vitest";
import type { Investor, OptionId, Property } from "@/contracts";
import { optimise, type StructureBuilder } from "../optimise";
import { buildA, buildB, buildC, buildD } from "@/agent/structures";

const B = { A: buildA, B: buildB, C: buildC, D: buildD };
const build: StructureBuilder = (items, o: OptionId, inv) =>
  B[o]({ id: "t", seed_id: items[0].id, items, totals: { price_gbp: 0, rent_pa_gbp: 0, blended_yield_pct: null, dwellings: 0 }, match_reason: "" }, inv);

const home = (id: string, price: number, extra: Partial<Property> = {}): Property => ({
  id, address: `${id}, Town`, postcode: "LU3 3DD", postcode_area: "LU", nation: "england", use: "residential",
  property_type: "house", tenure: "freehold", price_kind: "achieved", rent_pa_gbp: null, yield_pct: null, size_sqft: null,
  dwellings: 1, price_gbp: { value: price, source: { kind: "auction", file: "a.csv", row: 1 } }, ...extra,
});
const pension: Investor[] = [{ type: "uk_pension", label: "UK pension fund", pct: 100 }];
const family: Investor[] = [{ type: "family_office_uk", label: "UK family office", pct: 100 }];

describe("packet optimiser", () => {
  const five = [home("h1", 520_000), home("h2", 260_000), home("h3", 260_000), home("h4", 262_000), home("h5", 260_000)];

  it("never beats the single-structure price by inventing savings, and splits the £520k home out of a company", () => {
    const r = optimise(five, [], pension, build, { sameSeller: false, keepAll: true });
    expect(r.best.cost).toBeLessThanOrEqual(r.single.cost);
    expect(r.best.item_ids).toHaveLength(5);
    // No trust for a pension fund
    expect(r.options).not.toContain("D");
    expect(r.best.groups.flatMap((g) => g.item_ids).sort()).toEqual(five.map((p) => p.id).sort());
  });

  it("uses six-home non-residential rates only with one seller", () => {
    const extra = [home("c1", 255_000)];
    const apart = optimise(five, extra, pension, build, { sameSeller: false, keepAll: false });
    const together = optimise(five, extra, pension, build, { sameSeller: true, keepAll: false });
    const kept = optimise(five, extra, pension, build, { sameSeller: true, keepAll: true });
    expect(kept.added).toHaveLength(0);
    expect(together.best.rate_pct).toBeLessThan(apart.best.rate_pct);
    expect(together.added.map((p) => p.id)).toEqual(["c1"]);
    expect(together.best.groups.some((g) => g.item_ids.length >= 6)).toBe(true);
  });

  it("allows at most one family trust", () => {
    const r = optimise(five, [], family, build, { sameSeller: false, keepAll: true });
    expect(r.best.groups.filter((g) => g.option === "D").length).toBeLessThanOrEqual(1);
  });

  it("is fast enough on a full 12-lot pool", () => {
    const pool = Array.from({ length: 7 }, (_, i) => home(`c${i}`, 200_000 + i * 15_000));
    const t = performance.now();
    const r = optimise(five, pool, family, build, { sameSeller: true, keepAll: false });
    const ms = performance.now() - t;
    expect(r.best.item_ids.length).toBeGreaterThanOrEqual(4);
    expect(r.best.item_ids.length).toBeLessThanOrEqual(8);
    expect(ms).toBeLessThan(8000);
    console.log(`12-lot pool: ${r.engine_runs} engine runs in ${Math.round(ms)} ms; best ${r.best.groups.map((g) => `${g.option}×${g.item_ids.length}`).join(" + ")} at ${r.best.rate_pct.toFixed(2)}%`);
  });
});
