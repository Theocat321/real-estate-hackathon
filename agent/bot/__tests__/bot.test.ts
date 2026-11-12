import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sample from "../../../fixtures/sample.json";
import type { Packet, Structure } from "@/contracts";
import { runEngine } from "@/engine";
import {
  allowedAmounts, buildPacket, explainOption, formatBuildReply, parseCommand, poundsIn, quotesOnly,
  templateExplanation, type StudioApi,
} from "../commands";

const packet = sample.packet as Packet;
const structures = sample.structures as Structure[];

function fakeApi(calls: string[] = []): StudioApi {
  return {
    properties: async (q) => { calls.push(`properties:${q}`); return [packet.items[0]]; },
    match: async (req) => { calls.push(`match:${req.seed_id}`); return packet; },
    structures: async () => { calls.push("structures"); return structures; },
    engine: async (p, s, investors) => { calls.push("engine"); return runEngine({ packet: p, structures: s, investors }); },
  };
}

describe("parseCommand", () => {
  it("parses both commands", () => {
    expect(parseCommand("build packet from allsop-6392cf9c")).toEqual({ kind: "build", target: "allsop-6392cf9c" });
    expect(parseCommand('Build packet for "Wireless House"')).toEqual({ kind: "build", target: "Wireless House" });
    expect(parseCommand("explain option d")).toEqual({ kind: "explain", option: "D" });
    expect(parseCommand("explain B")).toEqual({ kind: "explain", option: "B" });
    expect(parseCommand("hello")).toEqual({ kind: "help" });
  });
});

describe("build packet", () => {
  it("id goes straight to match; address looks up first", async () => {
    const a: string[] = [];
    await buildPacket("allsop-6392cf9c", fakeApi(a), { appUrl: "http://x" });
    expect(a).toEqual(["match:allsop-6392cf9c", "structures", "engine"]);
    const b: string[] = [];
    await buildPacket("Wireless House", fakeApi(b), { appUrl: "http://x" });
    expect(b[0]).toBe("properties:Wireless House");
  });

  it("reply quotes golden totals and links the studio", async () => {
    const run = await buildPacket("allsop-6392cf9c", fakeApi(), { appUrl: "https://studio.example/" });
    const reply = formatBuildReply(run);
    expect(reply).toContain("£1,405,000");
    expect(reply).toContain("A. Buy each property directly: £49,250 on purchase");
    expect(reply).toContain("£265,250 on purchase");
    expect(reply).toContain("£432,000 on death (comparator)");
    expect(reply).toContain("https://studio.example/studio/pkt-sample-commercial");
    expect(reply).toContain("not tax advice");
  });
});

describe("explain option", () => {
  beforeEach(() => {
    process.env.GROK_CACHE_DIR = mkdtempSync(path.join(tmpdir(), "bot-cache-"));
    delete process.env.DEMO_MODE;
  });
  const runP = buildPacket("allsop-6392cf9c", fakeApi(), { appUrl: "http://x" });

  it("figure check: exact and shorthand", async () => {
    const allowed = allowedAmounts(await runP, "D");
    expect(poundsIn("£216k now or £432,000 later")).toEqual([{ value: 216000, step: 1000 }, { value: 432000, step: 0 }]);
    expect(quotesOnly("Pay £216k now or £432,000 later; packet £1.4m", allowed)).toBe(true);
    expect(quotesOnly("Saves £215,750 overall", allowed)).toBe(false);
    expect(quotesOnly("about £220k", allowed)).toBe(false);
  });

  it("accepts Grok prose that only quotes engine figures", async () => {
    const run = await runP;
    const transport = async () => JSON.stringify({ text: "The trust pays £216,000 on entry and up to £64,800 every ten years, versus £432,000 if the family held personally." });
    const r = await explainOption(run, "D", transport);
    expect(r.source).toBe("grok");
    expect(r.text).toContain("£216,000");
  });

  it("rejects Grok prose with an invented figure and falls back to engine rows", async () => {
    const run = await runP;
    const transport = async () => JSON.stringify({ text: "Option D saves the family £215,750 compared with holding directly, which is a great deal." });
    const r = await explainOption(run, "D", transport);
    expect(r.source).toBe("template");
    expect(r.warning).toMatch(/not in the engine output/);
    expect(r.text).toBe(templateExplanation(run, "D"));
    expect(r.text).toContain("IHT ENTRY £216,000");
    expect(r.text).toContain("[review]");
  });

  it("falls back when Grok is unavailable", async () => {
    const run = await runP;
    const r = await explainOption(run, "B", async () => { throw new Error("offline"); });
    expect(r.source).toBe("template");
    expect(r.text).toContain("STAMP DUTY SHARES £7,025");
  });
});
