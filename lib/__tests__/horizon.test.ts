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
  it("saves nothing when buying directly", () => {
    expect(saleSaving(result, "A")).toMatchObject({ directSdlt: 152_450, saleDuty: 152_450, saving: 0 });
  });
});

describe("breakdown", () => {
  it("is unchanged for holding periods", () => {
    expect(breakdown(result, "B", "25y", false).total).toBe(152_450 + 9_200 * 25);
  });
});
