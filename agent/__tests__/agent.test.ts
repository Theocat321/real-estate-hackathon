import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runEngine, ScenarioInputSchema } from "@/engine";
import sample from "@/fixtures/sample.json";
import type { Investor, Packet, Structure } from "@/agent/contract";
import { brochureToProperty, extractUpload, normalisePcts, numbersIn, pdfPages, verifyCited } from "@/agent/extract";
import { GrokCacheMiss, GrokInvalidResponse, grokJson, type Transport } from "@/agent/grok";
import { buildStructures, buildStructureTemplates, FALLBACK_RATIONALE } from "@/agent/structures";
import { makePdf } from "./helpers";

const samplePacket = () => structuredClone(sample.packet) as Packet;
const SAMPLE_INVESTORS = sample.investors as Investor[];
const SAMPLE_STRUCTURES = sample.structures as Structure[];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "grok-cache-"));
  process.env.GROK_CACHE_DIR = dir;
  delete process.env.DEMO_MODE;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.GROK_CACHE_DIR;
  delete process.env.DEMO_MODE;
});

const fake = (...replies: string[]): Transport & { calls: number } => {
  const t = (async () => replies[Math.min(t.calls++, replies.length - 1)]) as unknown as Transport & { calls: number };
  t.calls = 0;
  return t;
};

const UK_PENSION: Investor = { type: "uk_pension", label: "UK pension fund", pct: 60 };
const FAMILY: Investor = { type: "family_office_nonuk", label: "Hart Family Office", pct: 40 };

const shape = (st: Structure) => ({
  option: st.option,
  nodes: st.nodes.map((n) => `${n.id}:${n.kind}:${n.property_id ?? n.investor_type ?? n.trust_type ?? ""}`),
  edges: st.edges.map((e) => `${e.from}>${e.to}:${e.pct}`),
});

describe("structures (templates, not LLM)", () => {
  it("matches fixtures/sample.json node/edge shape for the sample packet", () => {
    const s = buildStructureTemplates(samplePacket(), SAMPLE_INVESTORS);
    expect(s.map((x) => x.option)).toEqual(["A", "B", "C", "D"]);
    expect(s.map(shape)).toEqual(SAMPLE_STRUCTURES.map(shape));
    expect(s.map((x) => x.name)).toEqual(SAMPLE_STRUCTURES.map((x) => x.name));
  });

  it("engine on generated structures reproduces the golden totals", () => {
    const structures = buildStructureTemplates(samplePacket(), SAMPLE_INVESTORS);
    const input = ScenarioInputSchema.parse({ packet: samplePacket(), investors: SAMPLE_INVESTORS, structures });
    const totals = runEngine(input).totals;
    const golden = sample.expected_engine as unknown as Record<string, unknown>;
    for (const o of ["A", "B", "C", "D"] as const) expect(totals[o], `option ${o}`).toEqual(golden[o]);
  });

  it("C is JPUT by default, RIF when all investors are UK", () => {
    const fund = (inv: Investor[]) => buildStructureTemplates(samplePacket(), inv)[2].nodes.find((n) => n.id === "fund")!;
    expect(fund([UK_PENSION, FAMILY])).toMatchObject({ fund_type: "JPUT", jurisdiction: "Jersey" });
    expect(fund([])).toMatchObject({ fund_type: "JPUT" });
    expect(fund(SAMPLE_INVESTORS)).toMatchObject({ fund_type: "RIF", jurisdiction: "UK" });
  });

  it("D settlor = family office investor if present, else Family (settlor)", () => {
    expect(buildStructureTemplates(samplePacket(), [UK_PENSION, FAMILY])[3].nodes[0]).toMatchObject({ id: "settlor", investor_type: "family_office_nonuk", label: "Hart Family Office (settlor)" });
    expect(buildStructureTemplates(samplePacket(), [{ ...UK_PENSION, pct: 100 }])[3].nodes[0]).toMatchObject({ id: "settlor", label: "Family (settlor)" });
  });

  it("Grok writes only rationale; numbers rejected, falls back to template", async () => {
    const good = JSON.stringify({ A: "Simple direct ownership.", B: "One company wrapper.", C: "Pooled fund vehicle.", D: "Estate planning via a trust." });
    const r = await buildStructures(samplePacket(), [UK_PENSION], fake(good));
    expect(r.structures.map((s) => s.rationale)).toEqual(["Simple direct ownership.", "One company wrapper.", "Pooled fund vehicle.", "Estate planning via a trust."]);
    expect(r.structures[1].nodes.map((n) => n.id)).toEqual(["buyer", "spv", "p1", "p2"]);

    const withNumbers = JSON.stringify({ A: "Costs £34,000.", B: "x is fine here.", C: "y is fine here.", D: "z is fine here." });
    const t = fake(withNumbers, withNumbers);
    const r2 = await buildStructures({ ...samplePacket(), id: "other" }, [{ ...FAMILY, pct: 100 }], t);
    expect(t.calls).toBe(2); // retried once
    expect(r2.structures[0].rationale).toBe(FALLBACK_RATIONALE.A);
    expect(r2.warnings[0]).toMatch(/template text/);
  });
});

describe("grok client", () => {
  const schema = z.object({ ok: z.boolean() });
  const req = { task: "t", system: "s", user: "u", schema };

  it("retries once on invalid JSON, then caches", async () => {
    const t = fake("not json", '```json\n{"ok": true}\n```');
    expect(await grokJson(req, t)).toEqual({ ok: true });
    expect(t.calls).toBe(2);
    expect(readdirSync(dir)).toHaveLength(1);
    // second call served from cache
    const t2 = fake('{"ok": false}');
    expect(await grokJson(req, t2)).toEqual({ ok: true });
    expect(t2.calls).toBe(0);
  });

  it("throws after second invalid response", async () => {
    await expect(grokJson(req, fake("{}", '{"ok": "nope"}'))).rejects.toBeInstanceOf(GrokInvalidResponse);
  });

  it("DEMO_MODE=1 serves only from cache", async () => {
    process.env.DEMO_MODE = "1";
    const t = fake('{"ok": true}');
    await expect(grokJson(req, t)).rejects.toBeInstanceOf(GrokCacheMiss);
    expect(t.calls).toBe(0);
    delete process.env.DEMO_MODE;
    await grokJson(req, t);
    process.env.DEMO_MODE = "1";
    expect(await grokJson(req, fake())).toEqual({ ok: true });
  });
});

describe("extract", () => {
  const PAGES = [
    ["Acuitus Lot 7", "Unit 4, Market Street, Leeds LS1 6DH", "Freehold Retail Investment"],
    ["Guide Price: £1,250,000", "Let at a current rent of £85,000 per annum exclusive", "Net initial yield 6.4%", "Total area 3,210 sq ft"],
  ];

  it("reads PDF text per page", async () => {
    const pages = await pdfPages(makePdf(PAGES));
    expect(pages.map((p) => p.num)).toEqual([1, 2]);
    expect(pages[1].text).toContain("£1,250,000");
  });

  it("keeps only values whose excerpt is verbatim on the cited page", async () => {
    const grokReply = {
      address: { value: "Unit 4, Market Street, Leeds", page: 1, excerpt: "Unit 4, Market Street, Leeds LS1 6DH" },
      postcode: { value: "LS1 6DH", page: 1, excerpt: "Leeds LS1 6DH" },
      property_type: { value: "Retail", page: 1, excerpt: "Freehold Retail Investment" },
      price_gbp: { value: 1250000, page: 2, excerpt: "Guide Price: £1,250,000" },
      price_kind: "guide",
      rent_pa_gbp: { value: 85000, page: 2, excerpt: "current rent of £85,000 per annum" },
      yield_pct: { value: 6.4, page: 1, excerpt: "Net initial yield 6.4%" }, // wrong page -> dropped
      size_sqft: { value: 3500, page: 2, excerpt: "Total area 3,210 sq ft" }, // value not in excerpt -> dropped
      tenure: { value: "Freehold", page: 1, excerpt: "Freehold Retail" },
      dwellings: null,
    };
    const res = await extractUpload("acuitus-lot7.pdf", makePdf(PAGES), "application/pdf", fake(JSON.stringify(grokReply)));
    const p = res.properties[0];
    expect(p.address).toBe("Unit 4, Market Street, Leeds");
    expect(p.tenure).toBe("freehold");
    expect(p.price_gbp).toMatchObject({ value: 1250000, source: { kind: "brochure", file: "acuitus-lot7.pdf", page: 2, excerpt: "Guide Price: £1,250,000" } });
    expect(p.price_kind).toBe("guide");
    expect(p.rent_pa_gbp?.value).toBe(85000);
    expect(p.postcode_area).toBe("LS");
    expect(p.use).toBe("commercial");
    expect(p.yield_pct).toBeNull();
    expect(p.size_sqft).toBeNull();
    expect(res.warnings.join("\n")).toMatch(/Dropped yield_pct: excerpt/);
    expect(res.warnings.join("\n")).toMatch(/Dropped size_sqft: value 3500/);
    const sourced = [p.price_gbp, p.rent_pa_gbp].filter((x) => x?.source.page && x.source.excerpt);
    expect(sourced.length).toBe(2);
  });

  it("verifyCited tolerates PDF line breaks but not invented text", () => {
    const pages = [{ num: 1, text: "Guide Price:\n£1,250,000\nplus VAT" }];
    const w: string[] = [];
    expect(verifyCited("price", { value: 1250000, page: 1, excerpt: "Guide Price: £1,250,000" }, pages, w)).not.toBeNull();
    expect(verifyCited("price", { value: 1250000, page: 1, excerpt: "Guide price £1.25m" }, pages, w)).toBeNull();
    expect(numbersIn("£1.25m and 3,210 sq ft")).toEqual([1250000, 3210]);
  });

  it("brochure with no verifiable address falls back to file name with warning", () => {
    const r = brochureToProperty("x.pdf", "abc", [{ num: 1, text: "nothing" }], {});
    expect(r.property.address).toBe("x.pdf");
    expect(r.warnings).toContain("Address not found in brochure; using file name");
  });

  it("maps auction CSV deterministically via lib/mapping", async () => {
    const csv = "result_id,source,lot_ref,url,address,postcode,auction_date,guide_price_gbp,achieved_price_gbp,achieved_vs_guide_pct,result_status,lot_type\nallsop-1,allsop,12,,Wireless House,E20 1HZ,2026-05-01,800000,890000,11,sold,Office\n";
    const t = fake();
    const res = await extractUpload("auctions.csv", new TextEncoder().encode(csv), "text/csv", t);
    expect(t.calls).toBe(0);
    expect(res.properties[0].price_gbp).toMatchObject({ value: 890000, source: { file: "auctions.csv", row: 1 } });
  });

  it("investor list via Grok, pcts normalised to 100", async () => {
    const reply = JSON.stringify({ investors: [{ label: "A Pension", type: "uk_pension", pct: 50 }, { label: "B FO", type: "family_office_nonuk", pct: 25 }] });
    const res = await extractUpload("investors.txt", new TextEncoder().encode("A Pension 50, B FO 25"), "text/plain", fake(reply));
    expect(res.properties).toEqual([]);
    expect(res.investors.map((i) => [i.label, i.type, i.pct])).toEqual([["A Pension", "uk_pension", 66.67], ["B FO", "family_office_nonuk", 33.33]]);
    expect(res.warnings[0]).toMatch(/rescaled/);
    const three = [{ pct: 1 }, { pct: 1 }, { pct: 1 }];
    normalisePcts(three);
    expect(three.reduce((a, b) => a + b.pct, 0)).toBeCloseTo(100, 10);
  });
});
