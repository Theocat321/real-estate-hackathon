import { describe, expect, it } from "vitest";
import { edgeLabel, flagMarker, nodeHeight } from "../structureChartLogic";

describe("edgeLabel", () => {
  it("settlor to trust settles, whatever the pct", () => {
    expect(edgeLabel("investor", "trust", 100)).toBe("settles");
  });
  it("fund, company, propco show the holding", () => {
    expect(edgeLabel("investor", "fund", 40)).toBe("units 40%");
    expect(edgeLabel("investor", "company", 60)).toBe("shares 60%");
    expect(edgeLabel("company", "propco", 100)).toBe("shares 100%");
  });
  it("property is owns, with pct when below 100", () => {
    expect(edgeLabel("company", "property", 100)).toBe("owns");
    expect(edgeLabel("investor", "property", 50)).toBe("owns 50%");
  });
});

describe("nodeHeight", () => {
  it("adds 18 per two badges", () => {
    expect(nodeHeight(0)).toBe(56);
    expect(nodeHeight(1)).toBe(74);
    expect(nodeHeight(2)).toBe(74);
    expect(nodeHeight(3)).toBe(92);
  });
});

describe("flagMarker", () => {
  it("picks ! over i, null when none", () => {
    expect(flagMarker([])).toBeNull();
    expect(flagMarker([{ severity: "info" }])).toBe("i");
    expect(flagMarker([{ severity: "info" }, { severity: "review" }])).toBe("!");
  });
});
