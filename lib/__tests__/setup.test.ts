import { describe, expect, it } from "vitest";
import sample from "../../fixtures/sample.json";
import type { CostRow, EngineResult, OptionId, Packet } from "@/contracts";
import { STUDIO_ASSUMPTIONS } from "../horizon";
import { adviserBrief, setupSteps } from "../setup";

const row = (option: OptionId, stage: CostRow["stage"], tax: CostRow["tax"], amount_gbp: number): CostRow =>
  ({ option, stage, tax, amount_gbp, entity_id: "x", formula: "", inputs: [], rule: { id: "r", citation_url: "", as_of: "" } }) as CostRow;

describe("setupSteps", () => {
  it("still asks for the ATED return when rental-business relief brings ATED to £0", () => {
    const result = { rows: [row("B", "hold", "ATED", 0)], flags: [], totals: {} } as unknown as EngineResult;
    const ated = setupSteps("B", undefined, result).find((s) => s.id === "ated");
    expect(ated).toBeDefined();
    expect(ated!.detail).toMatch(/relief/);
  });
  it("has no ATED step when no option row is ATED", () => {
    const result = { rows: [row("B", "acquire", "SDLT_NONRES", 100)], flags: [], totals: {} } as unknown as EngineResult;
    expect(setupSteps("B", undefined, result).some((s) => s.id === "ated")).toBe(false);
  });
});

describe("adviserBrief", () => {
  it("states the active assumptions in one sentence", () => {
    const brief = adviserBrief({
      option: "B",
      packet: sample.packet as Packet,
      structure: undefined,
      result: null,
      investors: [],
      steps: [],
      assumptions: STUDIO_ASSUMPTIONS,
    });
    expect(brief).toContain("Assumes homes are let to unconnected tenants (rental-business relief) and profits are paid out each year.");
  });
});
