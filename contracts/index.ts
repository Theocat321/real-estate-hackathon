// contracts/index.ts — Structure Studio shared contract.
// OWNED BY THE LEAD. Agents import from here and never edit it.
// Any change: ask the lead, who bumps CONTRACT_VERSION and tells every agent.

export const CONTRACT_VERSION = "1.0.0";

/* ───────────────────────── Provenance ───────────────────────── */

export type SourceKind = "listing" | "auction" | "brochure" | "upload" | "rule" | "user";

export interface SourceRef {
  kind: SourceKind;
  file: string;            // e.g. "listings.csv", "auction-results.csv", "acuitus-....pdf"
  row?: number;            // 1-based data row (header = row 0)
  page?: number;           // PDF page, 1-based
  record_id?: string;      // listing_id / result_id when available
  url?: string;            // source URL or citation URL
  excerpt?: string;        // <= 200 chars of the text the value came from
}

/** Every number shown in the UI is a Sourced<number>. No exceptions. */
export interface Sourced<T> {
  value: T;
  source: SourceRef;
}

/* ───────────────────────── Properties & packets ───────────────────────── */

export type Use = "commercial" | "residential" | "mixed";
export type Nation = "england" | "wales" | "scotland" | "ni";
export type PriceKind = "asking" | "guide" | "achieved" | "hmlr";

export interface Property {
  id: string;                         // listing_id or auction result_id
  address: string;
  postcode: string;
  postcode_area: string;              // "BA", "MK", "LS"... used for matching
  nation: Nation;                     // engine only prices England/NI in v1; others get a flag
  use: Use;
  property_type: string;              // raw value from data, e.g. "warehouse", "retail"
  tenure: "freehold" | "leasehold" | "unknown";
  price_gbp: Sourced<number> | null;
  price_kind: PriceKind | null;
  rent_pa_gbp: Sourced<number> | null;
  yield_pct: Sourced<number> | null;
  size_sqft: Sourced<number> | null;
  dwellings: number;                  // 0 for commercial; >=1 for residential (default 1)
}

export interface Packet {
  id: string;
  seed_id: string;
  items: Property[];                  // seed first
  totals: {
    price_gbp: number;
    rent_pa_gbp: number;
    blended_yield_pct: number | null; // rent / price * 100 where both known
    dwellings: number;
  };
  match_reason: string;               // one plain-English sentence
}

/* ───────────────────────── Investors & structures ───────────────────────── */

export type InvestorType =
  | "uk_pension"
  | "family_office_uk"
  | "family_office_nonuk"
  | "uk_company";

export interface Investor {
  type: InvestorType;
  label: string;
  pct: number;                        // 0–100, investors sum to 100
}

export type NodeKind = "investor" | "trust" | "fund" | "company" | "property";
export type OptionId = "A" | "B" | "C" | "D";

export interface StructNode {
  id: string;                         // unique within a Structure
  kind: NodeKind;
  label: string;
  jurisdiction?: "UK" | "Jersey" | "Guernsey" | "Luxembourg" | "Other";
  investor_type?: InvestorType;       // kind === "investor"
  trust_type?: "discretionary" | "unit_trust";   // kind === "trust"
  fund_type?: "JPUT" | "RIF";         // kind === "fund"
  property_id?: string;               // kind === "property" → Property.id
}

export interface StructEdge {
  from: string;                       // owner node id
  to: string;                         // owned node id
  pct: number;                        // 0–100
}

/**
 * A = buy each property directly
 * B = one UK SPV (PropCo Ltd) owns every property
 * C = fund (JPUT unit trust or RIF) owns every property directly
 * D = family discretionary trust owns PropCo
 * Every structure ends in one property node per packet item.
 */
export interface Structure {
  option: OptionId;
  name: string;
  nodes: StructNode[];
  edges: StructEdge[];
  rationale: string;                  // <= 2 sentences, written by the agent
}

/* ───────────────────────── Engine ───────────────────────── */

export type Stage = "acquire" | "hold" | "exit" | "ten_year" | "death";

export type TaxCode =
  | "SDLT_NONRES"
  | "SDLT_RES_HIGHER"
  | "SDLT_RES_COMPANY_17"
  | "STAMP_DUTY_SHARES"
  | "STAMP_DUTY_UNITS"
  | "ATED"
  | "CORP_TAX_RENT"
  | "IHT_ENTRY"
  | "IHT_TEN_YEAR"
  | "IHT_DEATH_COMPARATOR";

export interface RuleRef {
  id: string;                         // e.g. "sdlt_nonres_v2026"
  citation_url: string;
  as_of: string;                      // "2026-27"
}

export interface CostRow {
  option: OptionId;
  stage: Stage;
  entity_id: string;                  // StructNode.id that bears the cost
  tax: TaxCode;
  amount_gbp: number;                 // whole pounds, already rounded per rule
  formula: string;                    // human-readable, e.g. "0% to £150k + 2% to £250k + 5% on £640k"
  inputs: { label: string; value: number | string; source: SourceRef }[];
  rule: RuleRef;
}

export interface Flag {
  option: OptionId;
  entity_id: string;
  rule_id: string;
  severity: "info" | "review";        // "review" = needs a human adviser
  message: string;                    // one sentence
  citation_url?: string;
}

export interface ScenarioInput {
  packet: Packet;
  structures: Structure[];
  investors: Investor[];
  settlor_nrb_available_gbp?: number; // default 325000
}

export interface EngineResult {
  contract_version: string;
  rows: CostRow[];
  flags: Flag[];
  totals: Record<OptionId, Partial<Record<Stage, number>>>;
}

/* ───────────────────────── API surface ───────────────────────── */
// All routes are Next.js route handlers under /app/api. JSON in, JSON out.
// Errors: { error: string } with a 4xx/5xx status. Never throw raw stack traces to the UI.

export interface ExtractResponse {            // POST /api/extract  (multipart: file)
  properties: Property[];
  investors: Investor[];                      // empty if the file had none
  warnings: string[];
}

export interface PropertiesQuery {            // GET /api/properties?use=&q=&limit=
  use?: Use;
  q?: string;
  limit?: number;                             // default 50
}

export interface MatchRequest {               // POST /api/match
  seed_id: string;
  n?: number;                                 // default 5 (including seed)
  use?: Use;                                  // default: seed's use
  min_dwellings?: number;                     // residential packets, e.g. 6
}
export type MatchResponse = Packet;

export interface StructuresRequest {          // POST /api/structures
  packet: Packet;
  investors: Investor[];
}
export interface StructuresResponse {
  structures: Structure[];                    // always A, B, C, D in that order
}

export type EngineRequest = ScenarioInput;    // POST /api/engine
export type EngineResponse = EngineResult;

export interface ExportRequest {              // POST /api/export → application/pdf
  packet: Packet;
  structures: Structure[];
  result: EngineResult;
}
