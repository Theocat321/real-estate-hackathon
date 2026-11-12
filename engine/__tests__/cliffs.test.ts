import { describe, expect, it } from "vitest";
import type { OptionId, Property, ScenarioInput, Structure } from "@/contracts";
import { findCliffs } from "../cliffs";

function home(id: string, price: number, extra: Partial<Property> = {}): Property {
  return {
    id, address: `${id}, Somewhere`, postcode: "LU3 3DD", postcode_area: "LU", nation: "england", use: "residential",
    property_type: "house", tenure: "freehold", price_kind: "achieved", rent_pa_gbp: null, yield_pct: null, size_sqft: null,
    dwellings: 1, price_gbp: { value: price, source: { kind: "auction", file: "auction-results.csv", row: 1, record_id: id } },
    ...extra,
  };
}

function scenario(items: Property[], options: OptionId[] = ["A", "B", "D"]): ScenarioInput {
  const props = items.map((p, i) => ({ id: `p${i + 1}`, kind: "property" as const, label: p.id, property_id: p.id }));
  const structures: Structure[] = options.map((option) => {
    const owner = option === "A"
      ? { id: "buyer", kind: "investor" as const, label: "Buyer", investor_type: "uk_pension" as const }
      : { id: "spv", kind: "company" as const, label: "PropCo Ltd" };
    const extra = option === "D" ? [{ id: "settlor", kind: "investor" as const, label: "Family" }, { id: "trust", kind: "trust" as const, label: "Trust" }] : [];
    return {
      option, name: option, rationale: "",
      nodes: [...extra, owner, ...props],
      edges: [
        ...(option === "D" ? [{ from: "settlor", to: "trust", pct: 100 }, { from: "trust", to: "spv", pct: 100 }] : []),
        ...props.map((n) => ({ from: owner.id, to: n.id, pct: 100 })),
      ],
    };
  });
  return {
    packet: { id: "t", seed_id: items[0].id, items, totals: { price_gbp: 0, rent_pa_gbp: 0, blended_yield_pct: null, dwellings: 0 }, match_reason: "" },
    structures, investors: [],
  };
}

describe("tax-cliff finder", () => {
  it("finds the £500k company-rate cliff and prices it with the engine", () => {
    const cliffs = findCliffs(scenario([home("h1", 520_000), home("h2", 300_000)]));
    const c = cliffs.find((x) => x.kind === "price_threshold")!;
    expect(c.title).toContain("£500,000");
    // B: 17% of 520k = 88,400 vs higher rates on 500k = 40,000 → 48,400 SDLT, plus £4,600 ATED a year
    expect(c.savings.B).toEqual({ acquire: 48_400, hold: 4_600, ten_year: 0 });
    expect(c.best.option).toMatch(/B|D/);
    expect(c.probe_rows.every((r) => r.option === c.best.option)).toBe(true);
  });

  it("ignores ordinary price cuts with no threshold nearby", () => {
    const cliffs = findCliffs(scenario([home("h1", 380_000), home("h2", 300_000)], ["A", "B"]));
    expect(cliffs.filter((c) => c.kind === "price_threshold")).toHaveLength(0);
  });

  it("suggests real lots to reach six homes, flagged for review", () => {
    const items = [1, 2, 3, 4, 5].map((i) => home(`h${i}`, 260_000));
    const pool = [home("far", 255_000, { postcode_area: "SE" }), home("near", 262_000), home("land", 50_000, { property_type: "land" })];
    const c = findCliffs(scenario(items, ["B"]), pool).find((x) => x.kind === "six_homes")!;
    expect(c.added!.map((p) => p.id)).toEqual(["near"]);
    expect(c.severity).toBe("review");
    expect(c.best.acquire).toBeGreaterThan(0);
  });

  it("offers a second nil-rate band for option D", () => {
    const c = findCliffs(scenario([home("h1", 400_000), home("h2", 400_000)], ["D"])).find((x) => x.kind === "two_nil_rate_bands")!;
    // Entry 20% above NRB: (800k−325k)·20% = 95,000 vs (800k−650k)·20% = 30,000
    expect(c.savings.D!.acquire).toBe(65_000);
  });
});
