import { describe, expect, it } from "vitest";
import type { CostRow, EngineResult, OptionId } from "@/contracts";
import { breakdown, saleSaving } from "../horizon";

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
  const noRelief = { atedRelief: false, saleShare: 0.5 };
  it("counts ATED every year without relief", () => {
    expect(breakdown(result, "B", "25y", false, noRelief).total).toBe(152_450 + 9_200 * 25);
  });
  it("drops ATED with rental-business relief", () => {
    expect(breakdown(result, "B", "25y", false, { ...noRelief, atedRelief: true }).total).toBe(152_450);
  });
  it("nets the seller's share of the buyer's saving off when selling at the end", () => {
    const b = breakdown(result, "B", "25y_sell", false, { atedRelief: true, saleShare: 0.5 });
    expect(b.sale).toBe(-68_075);
    expect(b.total).toBe(152_450 - 68_075);
    expect(breakdown(result, "A", "25y_sell", false, { atedRelief: true, saleShare: 0.5 }).sale).toBe(0);
  });
  it("gets nothing back if the seller keeps none of the saving", () => {
    expect(breakdown(result, "B", "25y_sell", false, { atedRelief: true, saleShare: 0 }).sale).toBe(0);
  });
});
