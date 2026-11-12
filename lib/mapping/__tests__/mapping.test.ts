// Synthetic rows (test-only, not real data) exercising each mapping rule from BRIEF section 1.
import { describe, expect, it } from "vitest";
import type { Property } from "@/contracts";
import { auctionRowToProperty, listingRowToProperty, nationFromPostcode, postcodeArea, useFromType } from "../index";
import { buildPacket } from "../match";

describe("postcode helpers", () => {
  it("area = leading letters", () => {
    expect(postcodeArea("SW1A 1AA")).toBe("SW");
    expect(postcodeArea("G1 2AB")).toBe("G");
    expect(postcodeArea("")).toBe("");
  });
  it("nation", () => {
    expect(nationFromPostcode("EH1 1AA")).toBe("scotland");
    expect(nationFromPostcode("G1 1AA")).toBe("scotland");
    expect(nationFromPostcode("CF10 1AA")).toBe("wales");
    expect(nationFromPostcode("BT1 1AA")).toBe("ni");
    expect(nationFromPostcode("GL1 1AA")).toBe("england");
    expect(nationFromPostcode("M1 1AA")).toBe("england");
  });
});

describe("useFromType", () => {
  it("classifies", () => {
    expect(useFromType("Terraced house")).toBe("residential");
    expect(useFromType("Flat")).toBe("residential");
    expect(useFromType("Retail")).toBe("commercial");
    expect(useFromType("Shop with flat above")).toBe("mixed");
    expect(useFromType("mixed use")).toBe("mixed");
    expect(useFromType(null)).toBe("commercial");
  });
});

describe("listingRowToProperty", () => {
  const base = { listing_id: "L1", source: "testsrc", address: "1 Test St", postcode: "NW1 1AA", property_type: "Office", size_sqft: "1,200", yield_pct: "6.5", tenure: "Freehold", url: "https://example.test/L1" };
  it("asking price with source file+row", () => {
    const p = listingRowToProperty({ ...base, price_gbp: "£500,000", price_basis: "" }, 7, "listings.csv");
    expect(p.price_gbp?.value).toBe(500000);
    expect(p.price_kind).toBe("asking");
    expect(p.price_gbp?.source).toMatchObject({ kind: "listing", file: "listings.csv", row: 7, record_id: "L1", url: "https://example.test/L1" });
    expect(p.price_gbp?.source.excerpt).toContain("price_gbp=£500,000");
    expect(p.yield_pct?.value).toBe(6.5);
    expect(p.yield_pct?.source.row).toBe(7);
    expect(p.use).toBe("commercial");
    expect(p.dwellings).toBe(0);
    expect(p.postcode_area).toBe("NW");
    expect(p.tenure).toBe("freehold");
  });
  it("pa basis -> rent, hmlr fallback for price", () => {
    const p = listingRowToProperty({ ...base, price_gbp: "30000", price_basis: "pa", hmlr_price_gbp: "410000", hmlr_date: "2021-01-01" }, 2);
    expect(p.rent_pa_gbp?.value).toBe(30000);
    expect(p.price_gbp?.value).toBe(410000);
    expect(p.price_kind).toBe("hmlr");
  });
  it("rent pa / rent psf / auction-house guide", () => {
    const pa = listingRowToProperty({ ...base, price_gbp: "25000", price_basis: "rent pa", sale_or_let: "let" }, 3);
    expect(pa.rent_pa_gbp?.value).toBe(25000);
    expect(pa.price_gbp).toBeNull();
    const psf = listingRowToProperty({ ...base, price_gbp: "12.5", price_basis: "rent psf", sale_or_let: "let" }, 4);
    expect(psf.rent_pa_gbp?.value).toBe(15000);
    expect(listingRowToProperty({ ...base, source: "allsop", price_gbp: "1", price_basis: "guide/asking" }, 5).price_kind).toBe("guide");
    expect(listingRowToProperty({ ...base, source: "savills", price_gbp: "1", price_basis: "guide/asking" }, 6).price_kind).toBe("asking");
    expect(listingRowToProperty({ ...base, price_gbp: "1", price_basis: "guide (auction)" }, 1).price_kind).toBe("guide");
  });
});

describe("auctionRowToProperty", () => {
  it("achieved beats guide", () => {
    const p = auctionRowToProperty({ result_id: "A1", lot_ref: "12", address: "X", postcode: "SE1 1AA", guide_price_gbp: "100000", achieved_price_gbp: "120000", lot_type: "Residential" }, 3);
    expect(p.price_gbp?.value).toBe(120000);
    expect(p.price_kind).toBe("achieved");
    expect(p.price_gbp?.source).toMatchObject({ kind: "auction", file: "auction-results.csv", row: 3, record_id: "A1" });
    expect(p.dwellings).toBe(1);
  });
  it("guide when no achieved; blank type inference", () => {
    const p = auctionRowToProperty({ result_id: "A2", guide_price_gbp: "90000", lot_type: "Shop" }, 4);
    expect(p.price_kind).toBe("guide");
    expect(p.use).toBe("commercial");
    expect(auctionRowToProperty({ result_id: "Z", address: "Flat 2, 3 High St", lot_type: "" }, 1).use).toBe("residential");
    expect(auctionRowToProperty({ result_id: "Z", address: "Wireless House", lot_type: "" }, 1).property_type).toBe("unknown");
  });
});

function prop(id: string, price: number, over: Partial<Property> = {}): Property {
  return { ...auctionRowToProperty({ result_id: id, address: id, postcode: "SE1 1AA", achieved_price_gbp: String(price), lot_type: "Shop" }, 1), ...over };
}

describe("buildPacket", () => {
  it("filters by use/nation/±40%/known type and ranks; n includes seed", () => {
    const seed = prop("seed", 500000);
    const cands = [
      prop("near", 520000),
      prop("far", 900000),
      prop("res", 500000, { use: "residential", dwellings: 1 }),
      prop("scot", 500000, { nation: "scotland" }),
      prop("untyped", 500000, { property_type: "unknown" }),
      prop("other-area", 480000, { postcode_area: "N" }),
    ];
    const pk = buildPacket(seed, cands, { seed_id: "seed", n: 3 });
    expect(pk.seed_id).toBe("seed");
    expect(pk.items.map((i) => i.id)).toEqual(["seed", "near", "other-area"]);
    expect(pk.totals.price_gbp).toBe(1500000);
    expect(pk.match_reason).toMatch(/±40%/);
  });
  it("widens to ±60% when short", () => {
    const pk = buildPacket(prop("seed", 500000), [prop("a", 750000)], { seed_id: "seed", n: 2 });
    expect(pk.match_reason).toMatch(/±60%/);
    expect(pk.items).toHaveLength(2);
  });
  it("min_dwellings tops up with residential homes, skipping land", () => {
    const r = (id: string, over: Partial<Property> = {}) => prop(id, 200000, { use: "residential", property_type: "house", dwellings: 1, ...over });
    const pk = buildPacket(r("seed"), [r("land", { address: "Land at X" }), r("a"), r("b"), r("c"), r("d"), r("e"), r("f")], { seed_id: "seed", n: 2, min_dwellings: 6 });
    expect(pk.totals.dwellings).toBe(6);
    expect(pk.items.some((i) => i.id === "land")).toBe(false);
    expect(pk.match_reason).toMatch(/6 dwellings/);
  });
  it("blended yield over lots with rent and price", () => {
    const s = prop("s", 1000000, { rent_pa_gbp: { value: 50000, source: { kind: "listing", file: "t.csv", row: 1 } } });
    const pk = buildPacket(s, [prop("x", 1000000)], { seed_id: "s", n: 2 });
    expect(pk.totals.rent_pa_gbp).toBe(50000);
    expect(pk.totals.blended_yield_pct).toBe(5);
  });
});
