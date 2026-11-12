/**
 * Typed client for every Structure Studio endpoint (UI section).
 * Types come only from contracts/index.ts.
 *
 * USE_FIXTURES (NEXT_PUBLIC_USE_FIXTURES, default "true") serves the flow from
 * fixtures/sample.json with zero backend. The engine is pure, so fixture mode runs it
 * in-process instead of calling /api/engine. Set NEXT_PUBLIC_USE_FIXTURES=false at integration.
 */
import type {
  EngineResult,
  ExportRequest,
  ExtractResponse,
  Investor,
  InvestorType,
  MatchRequest,
  OptionId,
  Packet,
  PropertiesQuery,
  Property,
  ScenarioInput,
  Stage,
  Structure,
  StructuresResponse,
} from "@/contracts";
import type { Cliff } from "@/engine/cliffs";
import sample from "@/fixtures/sample.json";
import demoResidential from "@/fixtures/demo-residential.json";

export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES !== "false";

export const FOOTER =
  "Property data: sourced · Structure: simulated · Rules: cited · Decision support, not tax advice";

export const OPTIONS: OptionId[] = ["A", "B", "C", "D"];
export const STAGES: Stage[] = ["acquire", "hold", "exit", "ten_year", "death"];

const gbpFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
export const gbp = (n: number | null | undefined): string => (n == null ? "—" : gbpFmt.format(n));

/* ───────────────────────── Investor presets (toggle on /studio) ───────────────────────── */

export type InvestorPreset = "uk_pension" | "family_office";

export const INVESTOR_PRESETS: Record<InvestorPreset, Investor[]> = {
  uk_pension: [{ type: "uk_pension", label: "UK pension fund", pct: 100 }],
  family_office: [{ type: "family_office_nonuk", label: "Family office (non-UK)", pct: 100 }],
};

export const INVESTOR_TYPE_LABEL: Record<InvestorType, string> = {
  uk_pension: "UK pension",
  family_office_uk: "UK family office",
  family_office_nonuk: "Non-UK family office",
  uk_company: "UK company",
};

/* ───────────────────────── Fixtures ───────────────────────── */

interface SampleFixture {
  packet: Packet;
  investors: Investor[];
  structures: Structure[];
}
export const SAMPLE = sample as unknown as SampleFixture;

/**
 * Residential sample: the real Allsop demo packet without the lot that was added to reach six homes,
 * so it is priced at residential rates (and investor residence changes the SDLT).
 */
export const RESIDENTIAL_SAMPLE: Packet = (() => {
  const full = demoResidential as unknown as Packet;
  const items = full.items.slice(0, 5);
  return {
    ...full,
    id: "pkt-sample-residential",
    items,
    totals: {
      price_gbp: items.reduce((s, p) => s + (p.price_gbp?.value ?? 0), 0),
      rent_pa_gbp: items.reduce((s, p) => s + (p.rent_pa_gbp?.value ?? 0), 0),
      blended_yield_pct: null,
      dwellings: items.reduce((s, p) => s + p.dwellings, 0),
    },
    match_reason: `Five Allsop residential auction lots in England, each sold for about ${gbpFmt.format(260_000)}.`,
  };
})();

/* ───────────────────────── HTTP ───────────────────────── */

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: unknown }).error;
    throw new Error(typeof msg === "string" ? msg : `${url} failed (${res.status})`);
  }
  return body as T;
}

const postJson = <T>(url: string, body: unknown) =>
  http<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/* ───────────────────────── Endpoints ───────────────────────── */

/** GET /api/properties */
export async function searchProperties(query: PropertiesQuery): Promise<Property[]> {
  if (USE_FIXTURES) {
    const q = (query.q ?? "").toLowerCase();
    return SAMPLE.packet.items
      .filter((p) => !query.use || p.use === query.use)
      .filter((p) => !q || p.address.toLowerCase().includes(q) || p.postcode.toLowerCase().includes(q))
      .slice(0, query.limit ?? 50);
  }
  const sp = new URLSearchParams();
  if (query.use) sp.set("use", query.use);
  if (query.q) sp.set("q", query.q);
  if (query.limit) sp.set("limit", String(query.limit));
  return http<Property[]>(`/api/properties?${sp}`);
}

/** POST /api/match */
export async function match(req: MatchRequest): Promise<Packet> {
  if (USE_FIXTURES) return SAMPLE.packet;
  return postJson<Packet>("/api/match", req);
}

/** POST /api/structures */
export async function buildStructures(packet: Packet, investors: Investor[]): Promise<StructuresResponse> {
  // Structures are deterministic templates on the server (Grok only writes rationale, with a template
  // fallback), so this route works in fixture mode too and reflects the chosen investors.
  return postJson<StructuresResponse>("/api/structures", { packet, investors });
}

/** POST /api/engine */
export async function runScenario(input: ScenarioInput): Promise<EngineResult> {
  if (USE_FIXTURES) {
    const { runEngine } = await import("@/engine");
    return runEngine(input);
  }
  return postJson<EngineResult>("/api/engine", input);
}

/** POST /api/cliffs: thresholds near this scenario, each priced by re-running the engine. */
export async function findCliffs(input: ScenarioInput): Promise<Cliff[]> {
  return (await postJson<{ cliffs: Cliff[] }>("/api/cliffs", input)).cliffs;
}

/** POST /api/extract (multipart: file) */
export async function extract(file: File): Promise<ExtractResponse> {
  if (USE_FIXTURES) {
    return {
      properties: SAMPLE.packet.items,
      investors: SAMPLE.investors,
      warnings: [`Fixture mode: "${file.name}" was not parsed; showing the sample packet.`],
    };
  }
  const fd = new FormData();
  fd.set("file", file);
  return http<ExtractResponse>("/api/extract", { method: "POST", body: fd });
}

/** POST /api/export → application/pdf */
export async function exportPdf(req: ExportRequest): Promise<Blob> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  return res.blob();
}

/* ───────────────────────── Session store (packets survive navigation) ───────────────────────── */

const key = (id: string) => `ss:packet:${id}`;

export function savePacket(p: Packet): void {
  if (typeof window !== "undefined") sessionStorage.setItem(key(p.id), JSON.stringify(p));
}

export function loadPacket(id: string): Packet | null {
  if (id === SAMPLE.packet.id) return SAMPLE.packet;
  if (id === RESIDENTIAL_SAMPLE.id) return RESIDENTIAL_SAMPLE;
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key(id));
  return raw ? (JSON.parse(raw) as Packet) : null;
}
