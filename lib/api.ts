/**
 * Typed client for every Structure Studio endpoint (UI section).
 * Types come only from contracts/index.ts.
 * Always live: every call goes to its route handler.
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
  const sp = new URLSearchParams();
  if (query.use) sp.set("use", query.use);
  if (query.q) sp.set("q", query.q);
  if (query.limit) sp.set("limit", String(query.limit));
  return http<Property[]>(`/api/properties?${sp}`);
}

/** POST /api/match */
export async function match(req: MatchRequest): Promise<Packet> {
  return postJson<Packet>("/api/match", req);
}

/** POST /api/topup: add real residential lots from the data until the packet has six homes. */
export async function topUpToSixHomes(packet: Packet): Promise<Packet> {
  return postJson<Packet>("/api/topup", { packet });
}

/** Remembers which packet a topped-up packet came from, so the top-up can be undone. */
export function rememberBase(toppedId: string, baseId: string): void {
  if (typeof window !== "undefined") sessionStorage.setItem(`ss:base:${toppedId}`, baseId);
}
export function baseOf(id: string): string | null {
  return typeof window === "undefined" ? null : sessionStorage.getItem(`ss:base:${id}`);
}

/** POST /api/structures */
export async function buildStructures(packet: Packet, investors: Investor[]): Promise<StructuresResponse> {
  return postJson<StructuresResponse>("/api/structures", { packet, investors });
}

/** POST /api/engine */
export async function runScenario(input: ScenarioInput): Promise<EngineResult> {
  return postJson<EngineResult>("/api/engine", input);
}

/** POST /api/cliffs: thresholds near this scenario, each priced by re-running the engine. */
export async function findCliffs(input: ScenarioInput): Promise<Cliff[]> {
  return (await postJson<{ cliffs: Cliff[] }>("/api/cliffs", input)).cliffs;
}

/** POST /api/extract (multipart: file) */
export async function extract(file: File): Promise<ExtractResponse> {
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
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key(id));
  return raw ? (JSON.parse(raw) as Packet) : null;
}

/** A packet made of exactly the properties in an uploaded file, first one as the seed. */
export function packetFromUpload(items: Property[], fileName: string): Packet {
  const priced = items.filter((p) => p.price_gbp);
  const price = priced.reduce((s, p) => s + p.price_gbp!.value, 0);
  const rent = items.reduce((s, p) => s + (p.rent_pa_gbp?.value ?? 0), 0);
  const both = items.filter((p) => p.price_gbp && p.rent_pa_gbp);
  const bothPrice = both.reduce((s, p) => s + p.price_gbp!.value, 0);
  const bothRent = both.reduce((s, p) => s + p.rent_pa_gbp!.value, 0);
  let h = 0;
  for (const c of items.map((p) => p.id).join("|")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return {
    id: `pkt-upload-${h.toString(36)}`,
    seed_id: items[0].id,
    items,
    totals: {
      price_gbp: price,
      rent_pa_gbp: rent,
      blended_yield_pct: bothPrice > 0 ? Math.round((bothRent / bothPrice) * 10000) / 100 : null,
      dwellings: items.reduce((s, p) => s + p.dwellings, 0),
    },
    match_reason: `The ${items.length} properties in ${fileName}.`,
  };
}
