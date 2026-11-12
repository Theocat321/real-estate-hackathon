/**
 * Pure CSV-row → Property mapping (contracts/index.ts). No I/O.
 * Imported by /data, /lib/db and the Grok agent (/app/api/extract).
 */
import type { Nation, PriceKind, Property, Sourced, SourceRef, Use } from "@/contracts";

export type CsvRow = Record<string, string | undefined>;

const RES_RE = /house|flat|apartment|bungalow|cottage|residential|maisonette|dwelling/i;
const COM_RE = /shop|retail|office|industrial|warehouse|commercial|restaurant|pub|hotel|leisure|garage|factory|mixed/i;

/** Listing sources that are auction houses: their "guide/asking" prices are auction guides. */
const AUCTION_SOURCES = new Set(["acuitus", "allsop", "auctionhouse", "bondwolfe", "btg", "cliveemson", "pugh", "savillsauc"]);

const ADDRESS_RES_RE = /\b(flat|apartment|maisonette)\b/i;
const NON_DWELLING_RE = /\b(land|plot|site|garages?|ground rents?|parking|development)\b/i;

const SCOTLAND = new Set(["AB", "DD", "DG", "EH", "FK", "G", "HS", "IV", "KA", "KW", "KY", "ML", "PA", "PH", "TD", "ZE"]);
const WALES = new Set(["CF", "LD", "LL", "NP", "SA"]);

export const UNKNOWN_TYPE = "unknown";

export function postcodeArea(postcode: string | null | undefined): string {
  const m = (postcode ?? "").trim().toUpperCase().match(/^[A-Z]{1,2}/);
  return m ? m[0] : "";
}

export function nationFromPostcode(postcode: string | null | undefined): Nation {
  const area = postcodeArea(postcode);
  if (!area) return "england";
  if (area === "BT") return "ni";
  if (SCOTLAND.has(area)) return "scotland";
  if (WALES.has(area)) return "wales";
  return "england";
}

/** Residential if the type names a dwelling; mixed if it says "mixed" or also names a commercial use; else commercial. */
export function useFromType(type: string | null | undefined): Use {
  const t = type ?? "";
  if (/mixed/i.test(t)) return "mixed";
  if (!RES_RE.test(t)) return "commercial";
  const stripped = t.replace(new RegExp(RES_RE.source, "gi"), "");
  return COM_RE.test(stripped) ? "mixed" : "residential";
}

/** Blank lot type: infer only from an unambiguous address word (Flat/Apartment/Maisonette), else null. */
export function inferTypeFromAddress(address: string | null): string | null {
  const m = (address ?? "").match(ADDRESS_RES_RE);
  return m ? m[1].toLowerCase() : null;
}

/** True when a residential lot is land, a site, garages or ground rents rather than a home. */
export function isNonDwellingLot(p: Pick<Property, "property_type" | "address">): boolean {
  return NON_DWELLING_RE.test(`${p.property_type} ${p.address}`);
}

export function parseNumber(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[£,%\s]/g, "").trim();
  if (s === "" || s.toLowerCase() === "nan" || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function str(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

function excerptOf(row: CsvRow, cols: string[]): string {
  return cols
    .filter((c) => str(row[c]) != null)
    .map((c) => `${c}=${row[c]}`)
    .join("; ")
    .slice(0, 200);
}

function tenureOf(v: string | undefined): Property["tenure"] {
  const t = (v ?? "").toLowerCase();
  if (t.includes("leasehold")) return "leasehold";
  if (t.includes("freehold")) return "freehold";
  return "unknown";
}

type Base = Omit<SourceRef, "excerpt">;

function sourced<T>(value: T, base: Base, excerpt: string): Sourced<T> {
  return { value, source: { ...base, excerpt } };
}

/** Listings CSV row → Property. rowNumber is the 1-based data row (header = row 0). */
export function listingRowToProperty(row: CsvRow, rowNumber: number, file = "listings.csv"): Property {
  const recordId = str(row.listing_id) ?? `listing-${rowNumber}`;
  const src = str(row.source);
  const url = str(row.url);
  const base: Base = { kind: "listing", file, row: rowNumber, record_id: recordId, ...(url ? { url } : {}) };

  const address = str(row.address) ?? str(row.title) ?? recordId;
  const postcode = str(row.postcode) ?? "";
  const ptype = str(row.property_type) ?? inferTypeFromAddress(address);
  const use = useFromType(ptype);

  const price = parseNumber(row.price_gbp);
  const basis = (str(row.price_basis) ?? "").toLowerCase();
  const letting = (str(row.sale_or_let) ?? "").toLowerCase() === "let";
  const psf = /psf|per sq/.test(basis);
  const isRent = letting || basis.includes("rent") || basis === "pa" || basis === "pcm";
  const sqft = parseNumber(row.size_sqft);
  const hmlr = parseNumber(row.hmlr_price_gbp);

  let price_gbp: Sourced<number> | null = null;
  let price_kind: PriceKind | null = null;
  let rent_pa_gbp: Sourced<number> | null = null;

  if (price != null && isRent) {
    if (psf) {
      // Rent per sq ft: annualise only when size is known (rent_pa = £psf × sq ft).
      if (sqft != null) rent_pa_gbp = sourced(Math.round(price * sqft), base, excerptOf(row, ["price_gbp", "price_basis", "size_sqft", "price_text"]));
    } else {
      const pa = basis.includes("pcm") ? price * 12 : price;
      rent_pa_gbp = sourced(Math.round(pa), base, excerptOf(row, ["price_gbp", "price_basis", "price_text"]));
    }
  } else if (price != null) {
    price_kind = basis.includes("auction") || (src != null && AUCTION_SOURCES.has(src)) ? "guide" : "asking";
    price_gbp = sourced(Math.round(price), base, excerptOf(row, ["price_gbp", "price_basis", "price_text"]));
  }
  if (price_gbp == null && hmlr != null) {
    price_kind = "hmlr";
    price_gbp = sourced(Math.round(hmlr), base, excerptOf(row, ["hmlr_price_gbp", "hmlr_date"]));
  }

  const y = parseNumber(row.yield_pct);

  return {
    id: recordId,
    address,
    postcode,
    postcode_area: postcodeArea(postcode),
    nation: nationFromPostcode(postcode),
    use,
    property_type: ptype ?? UNKNOWN_TYPE,
    tenure: tenureOf(row.tenure),
    price_gbp,
    price_kind,
    rent_pa_gbp,
    yield_pct: y != null ? sourced(y, base, excerptOf(row, ["yield_pct"])) : null,
    size_sqft: sqft != null ? sourced(sqft, base, excerptOf(row, ["size_sqft", "size_unit"])) : null,
    dwellings: use === "commercial" ? 0 : 1,
  };
}

/** Auction results CSV row → Property. rowNumber is the 1-based data row (header = row 0). */
export function auctionRowToProperty(row: CsvRow, rowNumber: number, file = "auction-results.csv"): Property {
  const recordId = str(row.result_id) ?? `auction-${rowNumber}`;
  const url = str(row.url);
  const base: Base = { kind: "auction", file, row: rowNumber, record_id: recordId, ...(url ? { url } : {}) };

  const address = str(row.address) ?? recordId;
  const postcode = str(row.postcode) ?? "";
  const lotType = str(row.lot_type) ?? inferTypeFromAddress(address);
  const use = useFromType(lotType);

  const achieved = parseNumber(row.achieved_price_gbp);
  const guide = parseNumber(row.guide_price_gbp);
  let price_gbp: Sourced<number> | null = null;
  let price_kind: PriceKind | null = null;
  if (achieved != null) {
    price_kind = "achieved";
    price_gbp = sourced(Math.round(achieved), base, excerptOf(row, ["lot_ref", "achieved_price_gbp", "auction_date", "result_status"]));
  } else if (guide != null) {
    price_kind = "guide";
    price_gbp = sourced(Math.round(guide), base, excerptOf(row, ["lot_ref", "guide_price_gbp", "guide_price_text", "auction_date"]));
  }

  return {
    id: recordId,
    address,
    postcode,
    postcode_area: postcodeArea(postcode),
    nation: nationFromPostcode(postcode),
    use,
    property_type: lotType ?? UNKNOWN_TYPE,
    tenure: "unknown",
    price_gbp,
    price_kind,
    rent_pa_gbp: null,
    yield_pct: null,
    size_sqft: null,
    dwellings: use === "commercial" ? 0 : 1,
  };
}

/** Detect file shape by header. */
export function rowKind(headers: string[]): "listing" | "auction" | null {
  const h = new Set(headers.map((x) => x.trim()));
  if (h.has("result_id") || h.has("lot_ref")) return "auction";
  if (h.has("listing_id")) return "listing";
  return null;
}

export function rowToProperty(kind: "listing" | "auction", row: CsvRow, rowNumber: number, file?: string): Property {
  return kind === "auction" ? auctionRowToProperty(row, rowNumber, file) : listingRowToProperty(row, rowNumber, file);
}
