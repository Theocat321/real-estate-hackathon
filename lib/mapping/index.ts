/**
 * Pure CSV-row → Property mapping. No I/O. Imported by /data, /lib/db and the Grok agent.
 */
import type { Nation, PriceKind, Property, Sourced, SourceKind, SourceRef, Use } from "./types";

export type * from "./types";

export type CsvRow = Record<string, string | undefined>;

const RES_RE = /house|flat|apartment|bungalow|cottage|residential|maisonette|dwelling/i;
const COM_RE = /shop|retail|office|industrial|warehouse|commercial|restaurant|pub|hotel|leisure|garage|factory|mixed/i;

/** Listing sources that are auction houses: their "guide/asking" prices are auction guides. */
const AUCTION_SOURCES = new Set(["acuitus", "allsop", "auctionhouse", "bondwolfe", "btg", "cliveemson", "pugh", "savillsauc"]);

const ADDRESS_RES_RE = /\b(flat|apartment|maisonette)\b/i;

/** Blank lot type: infer residential only from an unambiguous address word, else null (unknown). */
export function inferTypeFromAddress(address: string | null): string | null {
  const m = (address ?? "").match(ADDRESS_RES_RE);
  return m ? m[1].toLowerCase() : null;
}

const NON_DWELLING_RE = /\b(land|plot|site|garages?|ground rents?|parking|development)\b/i;

/** 1 for a residential/mixed lot unless it is land, a site, garages or ground rents (not a dwelling). */
export function dwellingsFor(use: Use, type: string | null, address: string | null): number {
  if (use === "commercial") return 0;
  return NON_DWELLING_RE.test(`${type ?? ""} ${address ?? ""}`) ? 0 : 1;
}

const SCOTLAND = new Set(["AB", "DD", "DG", "EH", "FK", "G", "HS", "IV", "KA", "KW", "KY", "ML", "PA", "PH", "TD", "ZE"]);
const WALES = new Set(["CF", "LD", "LL", "NP", "SA"]);

export function postcodeArea(postcode: string | null | undefined): string | null {
  const m = (postcode ?? "").trim().toUpperCase().match(/^[A-Z]{1,2}/);
  return m ? m[0] : null;
}

export function nationFromPostcode(postcode: string | null | undefined): Nation {
  const area = postcodeArea(postcode);
  if (!area) return "england";
  if (area === "BT") return "ni";
  if (SCOTLAND.has(area)) return "scotland";
  if (WALES.has(area)) return "wales";
  return "england";
}

/** Brief: residential if type matches the dwelling regex, mixed if it also mentions a commercial use. */
export function useFromType(type: string | null | undefined): Use {
  const t = type ?? "";
  const res = RES_RE.test(t);
  if (/mixed/i.test(t)) return "mixed";
  if (!res) return "commercial";
  if (/mixed/i.test(t)) return "mixed";
  const stripped = t.replace(new RegExp(RES_RE.source, "gi"), "");
  return COM_RE.test(stripped) ? "mixed" : "residential";
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
    .join("; ");
}

function sourced<T>(value: T, base: Omit<SourceRef, "label" | "excerpt">, label: string, excerpt: string): Sourced<T> {
  return { value, source: { ...base, label, excerpt } };
}

function fileOf(source: string | null, fallback: string): string {
  return source ? `${source}` : fallback;
}

/** Listings CSV row → Property. rowNumber is the 1-based data row (header excluded). */
export function listingRowToProperty(row: CsvRow, rowNumber: number, file = "listings.csv"): Property {
  const recordId = str(row.listing_id) ?? `listing-${rowNumber}`;
  const src = str(row.source);
  const url = str(row.url);
  const kind: SourceKind = "listing";
  const base = { kind, file, row: rowNumber, record_id: recordId, ...(url ? { url } : {}) };
  const where = `${fileOf(src, file)} row ${rowNumber}`;

  const address = str(row.address) ?? recordId;
  const postcode = str(row.postcode);
  const ptype = str(row.property_type) ?? inferTypeFromAddress(str(row.address));
  const use = useFromType(ptype);

  const price = parseNumber(row.price_gbp);
  const basis = (str(row.price_basis) ?? "").toLowerCase();
  const letting = (str(row.sale_or_let) ?? "").toLowerCase() === "let";
  const psf = /psf|per sq/.test(basis);
  const isRent = letting || basis.includes("rent") || basis === "pa" || basis === "pcm";
  const sqftForRent = parseNumber(row.size_sqft);
  const hmlr = parseNumber(row.hmlr_price_gbp);

  let price_gbp: Sourced<number> | null = null;
  let price_kind: PriceKind | null = null;
  let rent_pa_gbp: Sourced<number> | null = null;

  if (price != null && isRent) {
    if (psf) {
      // Rent per sq ft: annualise only when size is known (rent_pa = £psf × sq ft).
      if (sqftForRent != null) {
        rent_pa_gbp = sourced(
          Math.round(price * sqftForRent),
          base,
          `Rent £${price}/sq ft × ${sqftForRent} sq ft (${where})`,
          excerptOf(row, ["price_gbp", "price_basis", "size_sqft", "price_text"]),
        );
      }
    } else {
      const pa = basis.includes("pcm") ? price * 12 : price;
      rent_pa_gbp = sourced(Math.round(pa), base, `Rent (${where})`, excerptOf(row, ["price_gbp", "price_basis", "price_text"]));
    }
  } else if (price != null) {
    price_kind = basis.includes("auction") || (src != null && AUCTION_SOURCES.has(src)) ? "guide" : "asking";
    price_gbp = sourced(Math.round(price), base, `Price, ${price_kind} (${where})`, excerptOf(row, ["price_gbp", "price_basis", "price_text"]));
  }
  if (price_gbp == null && hmlr != null) {
    price_kind = "hmlr";
    price_gbp = sourced(
      Math.round(hmlr),
      { ...base, kind: "hmlr" },
      `HM Land Registry price paid (${where})`,
      excerptOf(row, ["hmlr_price_gbp", "hmlr_date"]),
    );
  }

  const y = parseNumber(row.yield_pct);
  const sqft = parseNumber(row.size_sqft);

  return {
    id: recordId,
    name: address,
    address: sourced(address, base, `Address (${where})`, excerptOf(row, ["address"])),
    postcode: postcode ? sourced(postcode, base, `Postcode (${where})`, excerptOf(row, ["postcode"])) : null,
    postcode_area: postcodeArea(postcode),
    nation: nationFromPostcode(postcode),
    use,
    property_type: ptype,
    dwellings: dwellingsFor(use, ptype, address),
    price_gbp,
    price_kind,
    rent_pa_gbp,
    yield_pct: y != null ? sourced(y, base, `Yield (${where})`, excerptOf(row, ["yield_pct"])) : null,
    size_sqft: sqft != null ? sourced(sqft, base, `Size (${where})`, excerptOf(row, ["size_sqft"])) : null,
    tenure: str(row.tenure),
    url,
    source: { ...base, label: `Listing ${recordId} (${where})`, excerpt: excerptOf(row, ["address", "postcode", "property_type"]) },
  };
}

/** Auction results CSV row → Property. rowNumber is the 1-based data row (header excluded). */
export function auctionRowToProperty(row: CsvRow, rowNumber: number, file = "auctions.csv"): Property {
  const recordId = str(row.result_id) ?? `auction-${rowNumber}`;
  const src = str(row.source);
  const url = str(row.url);
  const base = { kind: "auction" as const, file, row: rowNumber, record_id: recordId, ...(url ? { url } : {}) };
  const lot = str(row.lot_ref);
  const where = `${fileOf(src, file)}${lot ? ` lot ${lot}` : ""}, row ${rowNumber}`;

  const address = str(row.address) ?? recordId;
  const postcode = str(row.postcode);
  const lotType = str(row.lot_type) ?? inferTypeFromAddress(str(row.address));
  const use = useFromType(lotType);

  const achieved = parseNumber(row.achieved_price_gbp);
  const guide = parseNumber(row.guide_price_gbp);
  let price_gbp: Sourced<number> | null = null;
  let price_kind: PriceKind | null = null;
  if (achieved != null) {
    price_kind = "achieved";
    price_gbp = sourced(Math.round(achieved), base, `Achieved price (${where})`, excerptOf(row, ["achieved_price_gbp", "auction_date", "result_status"]));
  } else if (guide != null) {
    price_kind = "guide";
    price_gbp = sourced(Math.round(guide), base, `Guide price (${where})`, excerptOf(row, ["guide_price_gbp", "auction_date"]));
  }

  return {
    id: recordId,
    name: address,
    address: sourced(address, base, `Address (${where})`, excerptOf(row, ["address"])),
    postcode: postcode ? sourced(postcode, base, `Postcode (${where})`, excerptOf(row, ["postcode"])) : null,
    postcode_area: postcodeArea(postcode),
    nation: nationFromPostcode(postcode),
    use,
    property_type: lotType,
    dwellings: dwellingsFor(use, lotType, address),
    price_gbp,
    price_kind,
    rent_pa_gbp: null,
    yield_pct: null,
    size_sqft: null,
    tenure: null,
    url,
    source: { ...base, label: `Auction lot ${lot ?? recordId} (${where})`, excerpt: excerptOf(row, ["address", "postcode", "lot_type"]) },
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
