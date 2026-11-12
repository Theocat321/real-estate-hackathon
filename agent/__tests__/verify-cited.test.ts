import { describe, expect, it } from "vitest";
import { excerptAround, verifyCited } from "../extract";

const pages = [{ num: 1, text: "Lot 13, Beyond Retro, 23 Gloucester Road, Brighton,\nEast Sussex BN1 4AD\nFreehold retail investment" }];

describe("verifyCited: excerpt cut at a line break", () => {
  it("keeps a text value that is verbatim on the page and widens the excerpt", () => {
    const warnings: string[] = [];
    const r = verifyCited("address", { value: "23 Gloucester Road, Brighton, East Sussex", page: 1, excerpt: "Lot 13, Beyond Retro, 23 Gloucester Road, Brighton," }, pages, warnings);
    expect(warnings).toEqual([]);
    expect(r?.excerpt).toContain("23 Gloucester Road, Brighton, East Sussex");
    expect(r!.excerpt.length).toBeLessThanOrEqual(200);
  });

  it("still drops a text value that is not on the page", () => {
    const warnings: string[] = [];
    const r = verifyCited("address", { value: "23 Gloucester Road, Hove", page: 1, excerpt: "23 Gloucester Road, Brighton," }, pages, warnings);
    expect(r).toBeNull();
    expect(warnings[0]).toMatch(/Dropped address/);
  });

  it("numbers stay strict (no widening)", () => {
    const warnings: string[] = [];
    expect(verifyCited("price_gbp", { value: 875000, page: 1, excerpt: "Freehold retail investment" }, pages, warnings)).toBeNull();
  });

  it("excerptAround returns null when absent", () => {
    expect(excerptAround("abc def", "xyz")).toBeNull();
  });
});
