/**
 * Upload extraction: listings/auction CSV (deterministic), sale-brochure PDF (Grok + verbatim
 * excerpt check), investor list (Grok). Every dropped value is reported in warnings[].
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Papa from "papaparse";
import { z } from "zod";
import { nationFromPostcode, postcodeArea, rowKind, rowToProperty, useFromType, type CsvRow } from "@/lib/mapping";
import type { ExtractResponse, Investor, Property, Sourced, SourceRef } from "./contract";
import { InvestorTypeSchema } from "./contract";
import { grokJson, type Transport } from "./grok";

// ---------------------------------------------------------------------------
// CSV (listings / auctions)

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const res = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return { headers: res.meta.fields ?? [], rows: res.data };
}

export function extractPropertiesCsv(file: string, text: string): ExtractResponse | null {
  const { headers, rows } = parseCsv(text);
  const kind = rowKind(headers);
  if (!kind) return null;
  const warnings: string[] = [];
  const properties: Property[] = [];
  rows.forEach((row, i) => {
    try {
      properties.push(rowToProperty(kind, row, i + 1, file));
    } catch (e) {
      warnings.push(`Row ${i + 1} dropped: ${(e as Error).message}`);
    }
  });
  properties.forEach((p, i) => {
    if (!p.price_gbp) warnings.push(`${p.id}: no price (${file} row ${i + 1})`);
  });
  return { properties, investors: [], warnings };
}

// ---------------------------------------------------------------------------
// Brochure PDF

export interface PdfPage {
  num: number;
  text: string;
}

export async function pdfPages(data: Uint8Array): Promise<PdfPage[]> {
  const { PDFParse } = await import("pdf-parse");
  // Next.js bundles pdfjs into .next chunks without its worker file. Load the worker module ourselves
  // (bundler-ignored) and hand it to pdfjs via globalThis.pdfjsWorker, its main-thread worker hook.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) {
    const workerUrl = pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
    g.pdfjsWorker = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ workerUrl);
  }
  const parser = new PDFParse({ data });
  try {
    const r = await parser.getText();
    return r.pages.map((p) => ({ num: p.num, text: p.text }));
  } finally {
    await parser.destroy();
  }
}

const Cited = <T extends z.ZodType>(v: T) => z.object({ value: v, page: z.number().int().min(1), excerpt: z.string().min(1) }).nullable().optional();

export const BrochureSchema = z.object({
  address: Cited(z.string().min(3)),
  postcode: Cited(z.string().min(2)),
  property_type: Cited(z.string().min(2)),
  price_gbp: Cited(z.number().positive()),
  price_kind: z.enum(["guide", "asking"]).nullable().optional(),
  rent_pa_gbp: Cited(z.number().positive()),
  yield_pct: Cited(z.number().positive().max(50)),
  size_sqft: Cited(z.number().positive()),
  tenure: Cited(z.string().min(2)),
  dwellings: Cited(z.number().int().nonnegative()),
});
export type BrochureFields = z.infer<typeof BrochureSchema>;

const BROCHURE_SYSTEM = `You extract facts from a UK commercial/residential property sale brochure (e.g. an Acuitus or Allsop lot).
For each field return {"value": ..., "page": <page number>, "excerpt": "<short text copied EXACTLY, character for character, from that page>"} or null if the brochure does not state it.
The excerpt must be a verbatim substring of the page text (10-120 characters) that contains the value. Never infer, convert or calculate a value that is not printed.
Fields: address (string, without postcode), postcode (string), property_type (string, e.g. "Retail", "Office", "Residential flats"), price_gbp (number, guide or asking price in pounds), price_kind ("guide" | "asking" | null, not cited),
rent_pa_gbp (number, current gross rent per annum in pounds), yield_pct (number, e.g. 7.25), size_sqft (number, total floor area in square feet), tenure (string, e.g. "Freehold"), dwellings (integer, number of residential units, only if stated).
Return JSON with exactly these keys.`;

const MAX_PAGE_CHARS = 6000;

export function brochurePrompt(pages: PdfPage[]): string {
  return pages.map((p) => `=== PAGE ${p.num} ===\n${p.text.slice(0, MAX_PAGE_CHARS)}`).join("\n\n");
}

/** Collapse whitespace and normalise quotes/dashes so PDF line breaks don't defeat a verbatim match. Case is kept. */
export function norm(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every number mentioned in a string, expanding k / m / million suffixes. */
export function numbersIn(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(m\b|million|k\b|bn\b)?/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const suf = (m[2] ?? "").toLowerCase();
    out.push(suf === "m" || suf === "million" ? n * 1e6 : suf === "k" ? n * 1e3 : suf === "bn" ? n * 1e9 : n);
  }
  return out;
}

function numberSupported(value: number, excerpt: string): boolean {
  return numbersIn(excerpt).some((n) => Math.abs(n - value) <= Math.max(0.005 * Math.abs(value), 0.01));
}

function textSupported(value: string, excerpt: string): boolean {
  const v = norm(value).toLowerCase();
  const e = norm(excerpt).toLowerCase();
  if (e.includes(v)) return true;
  // multi-part values (addresses): every significant token must appear in the excerpt
  const tokens = v.split(/[ ,]+/).filter((t) => t.length > 2);
  return tokens.length > 0 && tokens.every((t) => e.includes(t));
}

type CitedValue = { value: string | number; page: number; excerpt: string };

/** Whitespace-normalised page text around a verbatim (case-insensitive) occurrence of value, max 200 chars; null if absent. */
export function excerptAround(pageText: string, value: string): string | null {
  const text = norm(pageText);
  const v = norm(value);
  if (v.length < 3 || v.length > 200) return null;
  const i = text.toLowerCase().indexOf(v.toLowerCase());
  if (i < 0) return null;
  const pad = Math.max(0, Math.floor((200 - v.length) / 2));
  return text.slice(Math.max(0, i - pad), Math.min(text.length, i + v.length + pad)).trim();
}

/**
 * Keep a cited value only if (1) its page exists, (2) its excerpt appears verbatim in that page's
 * text (whitespace-normalised), and (3) the value itself is present in the excerpt.
 */
export function verifyCited(field: string, c: CitedValue | null | undefined, pages: PdfPage[], warnings: string[]): CitedValue | null {
  if (!c) return null;
  const page = pages.find((p) => p.num === c.page);
  if (!page) {
    warnings.push(`Dropped ${field}: page ${c.page} does not exist`);
    return null;
  }
  if (!norm(page.text).includes(norm(c.excerpt))) {
    warnings.push(`Dropped ${field}: excerpt "${c.excerpt}" not found verbatim on page ${c.page}`);
    return null;
  }
  const ok = typeof c.value === "number" ? numberSupported(c.value, c.excerpt) : textSupported(c.value, c.excerpt);
  if (!ok && typeof c.value === "string") {
    // Grok's excerpt often stops at a PDF line break mid-value (e.g. an address split over two lines).
    // If the value itself is verbatim on the cited page, keep it and widen the excerpt to cover it.
    const widened = excerptAround(page.text, c.value);
    if (widened) return { ...c, excerpt: widened };
  }
  if (!ok) {
    warnings.push(`Dropped ${field}: value ${JSON.stringify(c.value)} not present in excerpt "${c.excerpt}" (page ${c.page})`);
    return null;
  }
  return c;
}

export function brochureToProperty(file: string, fileSha: string, pages: PdfPage[], f: BrochureFields): { property: Property; warnings: string[] } {
  const warnings: string[] = [];
  const v = <K extends keyof BrochureFields>(k: K) => verifyCited(k, f[k] as CitedValue | null | undefined, pages, warnings);

  const src = (c: CitedValue): SourceRef => ({ kind: "brochure", file, page: c.page, excerpt: c.excerpt.slice(0, 200) });
  const s = <T>(c: CitedValue | null, map: (x: CitedValue["value"]) => T): Sourced<T> | null => (c ? { value: map(c.value), source: src(c) } : null);

  const addr = v("address");
  const pc = v("postcode");
  const ptype = v("property_type");
  const price = v("price_gbp");
  const rent = v("rent_pa_gbp");
  const yld = v("yield_pct");
  const size = v("size_sqft");
  const tenure = v("tenure");
  const dw = v("dwellings");

  const postcode = pc ? String(pc.value).toUpperCase().trim() : "";
  const property_type = ptype ? String(ptype.value).toLowerCase() : "unknown";
  const use = useFromType(property_type);
  const tenureText = tenure ? String(tenure.value).toLowerCase() : "";

  if (!addr) warnings.push("Address not found in brochure; using file name");
  if (!price) warnings.push("No verifiable price in brochure");

  const property: Property = {
    id: `brochure-${fileSha.slice(0, 10)}`,
    address: addr ? String(addr.value) : file,
    postcode,
    postcode_area: postcodeArea(postcode),
    nation: nationFromPostcode(postcode),
    use,
    property_type,
    tenure: tenureText.includes("freehold") ? "freehold" : tenureText.includes("leasehold") ? "leasehold" : "unknown",
    price_gbp: s(price, (x) => Math.round(Number(x))),
    price_kind: price ? (f.price_kind ?? "asking") : null,
    rent_pa_gbp: s(rent, (x) => Math.round(Number(x))),
    yield_pct: s(yld, Number),
    size_sqft: s(size, (x) => Math.round(Number(x))),
    dwellings: dw ? Number(dw.value) : use === "commercial" ? 0 : 1,
  };
  return { property, warnings };
}

export async function extractBrochure(file: string, data: Uint8Array, transport?: Transport): Promise<ExtractResponse> {
  const fileSha = createHash("sha1").update(data).digest("hex");
  const pages = await pdfPages(data);
  const warnings: string[] = [];
  if (pages.every((p) => p.text.trim().length < 20)) warnings.push("PDF has little or no text layer (scanned?); extraction may be empty");
  const fields = await grokJson({ task: "brochure-extract", system: BROCHURE_SYSTEM, user: brochurePrompt(pages), schema: BrochureSchema }, transport);
  const r = brochureToProperty(file, fileSha, pages, fields);
  return { properties: [r.property], investors: [], warnings: [...warnings, ...r.warnings] };
}

// ---------------------------------------------------------------------------
// Investor list (CSV or free text)

export const InvestorListSchema = z.object({
  investors: z.array(z.object({ type: InvestorTypeSchema, label: z.string().min(1), pct: z.number().min(0).max(100) })).min(1),
});

const INVESTOR_SYSTEM = `You map an investor list (CSV or free text) for a UK property deal into structured investors.
For each investor return label (their name as written), type (one of: "uk_pension" for UK pension schemes, "family_office_uk" for UK family offices or UK families/individuals,
"family_office_nonuk" for non-UK family offices, families, individuals or funds, "uk_company" for UK companies), and pct (their share of equity, 0-100).
Only use shares stated in the input. If no shares are stated, split equally. Return JSON: {"investors": [...]}.`;

/** Make pcts sum to exactly 100 (2 dp). Returns a warning if a rescale was needed. */
export function normalisePcts(list: { pct: number }[]): string | null {
  const sum = list.reduce((a, i) => a + i.pct, 0);
  let warning: string | null = null;
  if (sum <= 0) {
    list.forEach((i) => (i.pct = 100 / list.length));
    warning = "No investor shares given; split equally";
  } else if (Math.abs(sum - 100) > 0.5) {
    list.forEach((i) => (i.pct = (i.pct * 100) / sum));
    warning = `Investor shares summed to ${Math.round(sum * 100) / 100}; rescaled to 100`;
  }
  list.forEach((i) => (i.pct = Math.round(i.pct * 100) / 100));
  const drift = Math.round((100 - list.reduce((a, i) => a + i.pct, 0)) * 100) / 100;
  if (drift !== 0) list[list.length - 1].pct = Math.round((list[list.length - 1].pct + drift) * 100) / 100;
  return warning;
}

export async function extractInvestors(file: string, text: string, transport?: Transport): Promise<ExtractResponse> {
  const r = await grokJson({ task: "investor-list", system: INVESTOR_SYSTEM, user: text.slice(0, 20_000), schema: InvestorListSchema }, transport);
  const investors: Investor[] = r.investors.map((i) => ({ ...i }));
  const warnings: string[] = [];
  const w = normalisePcts(investors);
  if (w) warnings.push(w);
  return { properties: [], investors, warnings };
}

// ---------------------------------------------------------------------------
// Dispatcher

export async function extractUpload(file: string, data: Uint8Array, mime = "", transport?: Transport): Promise<ExtractResponse> {
  const lower = file.toLowerCase();
  const isPdf = lower.endsWith(".pdf") || mime === "application/pdf" || (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46);
  if (isPdf) return extractBrochure(file, data, transport);

  const text = new TextDecoder().decode(data);
  if (lower.endsWith(".csv") || mime.includes("csv")) {
    const props = extractPropertiesCsv(file, text);
    if (props) return props;
  }
  return extractInvestors(file, text, transport);
}
