import { describe, expect, it } from "vitest";
import type { CostRow, EngineResult, OptionId } from "@/contracts";
import { STUDIO_ASSUMPTIONS, assumptionsFromQuery, assumptionsQuery, assumptionsSentence, breakdown, saleSaving } from "../horizon";

const row = (option: OptionId, stage: CostRow["stage"], tax: CostRow["tax"], amount_gbp: number): CostRow =>
  ({ option, stage, tax, amount_gbp, entity_id: "x", formula: "", inputs: [], rule: { id: "r", citation_url: "", as_of: "" } }) as CostRow;

const result = {
  rows: [
    row("A", "acquire", "SDLT_NONRES", 152_450),
    row("B", "acquire", "SDLT_NONRES", 152_450),
    row("B", "hold", "ATED", 9_200),
    row("B", "exit", "STAMP_DUTY_SHARES", 16_300),
    row("C", "exit", "STAMP_DUTY_UNITS", 0),
    row("D", "acquire", "IHT_ENTRY", 500_000),
    row("D", "exit", "STAMP_DUTY_SHARES", 16_300),
  ],
} as unknown as EngineResult;

describe("saleSaving", () => {
  it("saves the next buyer SDLT minus share stamp duty on a share sale", () => {
    const s = saleSaving(result, "B");
    expect(s).toMatchObject({ directSdlt: 152_450, saleDuty: 16_300, saving: 136_150 });
  });
  it("uses only SDLT, not trust entry charges, as the direct-purchase benchmark", () => {
    expect(saleSaving(result, "D").saving).toBe(136_150);
  });
  it("saves the full SDLT when fund units are sold free of stamp duty", () => {
    expect(saleSaving(result, "C")).toMatchObject({ saleDuty: 0, saving: 152_450 });
  });
  it("saves nothing when buying directly", () => {
    expect(saleSaving(result, "A")).toMatchObject({ directSdlt: 152_450, saleDuty: 152_450, saving: 0 });
  });
});

describe("breakdown", () => {
  const noRelief = { rentalRelief: false, distributeProfits: true, saleShare: 0.5 };
  it("counts ATED every year without relief", () => {
    expect(breakdown(result, "B", "25y", false, noRelief).total).toBe(152_450 + 9_200 * 25);
  });
  it("adds whatever hold rows the engine returned, with no client-side ATED filter", () => {
    expect(breakdown(result, "B", "25y", false, { ...noRelief, rentalRelief: true }).total).toBe(152_450 + 9_200 * 25);
  });
  it("nets the seller's share of the buyer's saving off when selling at the end", () => {
    const b = breakdown(result, "B", "25y_sell", false, { rentalRelief: true, distributeProfits: true, saleShare: 0.5 });
    expect(b.sale).toBe(-68_075);
    expect(b.total).toBe(152_450 + 9_200 * 25 - 68_075);
    expect(breakdown(result, "A", "25y_sell", false, { rentalRelief: true, distributeProfits: true, saleShare: 0.5 }).sale).toBe(0);
  });
  it("gets nothing back if the seller keeps none of the saving", () => {
    expect(breakdown(result, "B", "25y_sell", false, { rentalRelief: true, distributeProfits: true, saleShare: 0 }).sale).toBe(0);
  });
});

describe("shared engine assumptions", () => {
  it("one default for every engine caller: rental relief on, profits paid out", () => {
    expect(STUDIO_ASSUMPTIONS).toEqual({ rental_relief: true, distribute_profits: true });
  });
  it("round-trips through the Setup link query", () => {
    const off = { rental_relief: false, distribute_profits: false };
    expect(assumptionsQuery(STUDIO_ASSUMPTIONS)).toBe("relief=1&dividends=1");
    expect(assumptionsFromQuery(new URLSearchParams(assumptionsQuery(off)))).toEqual(off);
    expect(assumptionsFromQuery(new URLSearchParams("relief=0"))).toEqual({ rental_relief: false, distribute_profits: true });
  });
  it("defaults to the Studio assumptions when the query has none", () => {
    expect(assumptionsFromQuery(new URLSearchParams(""))).toEqual(STUDIO_ASSUMPTIONS);
  });
  it("states the assumptions in one plain sentence", () => {
    expect(assumptionsSentence(STUDIO_ASSUMPTIONS)).toBe(
      "Assumes homes are let to unconnected tenants (rental-business relief) and profits are paid out each year.",
    );
    expect(assumptionsSentence({ rental_relief: false, distribute_profits: false })).toBe(
      "Assumes no rental-business relief is claimed and profits are kept in the company.",
    );
  });
});
