/**
 * TEMPORARY local stub. contracts/index.ts does not exist yet.
 * When it lands, replace this file's body with:
 *   export type { SourceRef, Sourced, Property, Packet, PacketItem, MatchRequest } from "@/contracts";
 * Shapes here follow BRIEF.md section 1 and align with engine/schema.ts SourceRef.
 */

export type SourceKind = "listing" | "auction" | "brochure" | "hmlr" | "user" | "assumption";

export interface SourceRef {
  kind: SourceKind;
  file?: string;
  row?: number;
  page?: number;
  record_id?: string;
  excerpt?: string;
  label: string;
  url?: string;
}

export interface Sourced<T> {
  value: T;
  source: SourceRef;
}

export type Use = "residential" | "commercial" | "mixed";
export type Nation = "england" | "scotland" | "wales" | "ni";
export type PriceKind = "achieved" | "guide" | "asking" | "hmlr";

export interface Property {
  id: string;
  name: string;
  address: Sourced<string>;
  postcode: Sourced<string> | null;
  postcode_area: string | null;
  nation: Nation;
  use: Use;
  property_type: string | null;
  dwellings: number;
  price_gbp: Sourced<number> | null;
  price_kind: PriceKind | null;
  rent_pa_gbp: Sourced<number> | null;
  yield_pct: Sourced<number> | null;
  size_sqft: Sourced<number> | null;
  tenure: string | null;
  url: string | null;
  source: SourceRef;
}

export interface MatchRequest {
  seed_id: string;
  n?: number;
  min_dwellings?: number;
}

export interface PacketItem {
  property: Property;
  score: number;
  match_reason: string;
}

export interface Packet {
  id: string;
  seed: Property;
  items: PacketItem[];
  totals: {
    price_gbp: number;
    rent_pa_gbp: number | null;
    blended_yield_pct: number | null;
    dwellings: number;
  };
  criteria: {
    use: Use;
    nation: Nation;
    price_band_pct: number;
    n: number;
    min_dwellings: number | null;
  };
}
