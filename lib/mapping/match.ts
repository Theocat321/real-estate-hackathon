/**
 * Deterministic packet builder (BRIEF section 1, step 5). Pure: no I/O, no LLM.
 */
import type { MatchRequest, Packet, PacketItem, Property } from "./types";

const SKIP_NATIONS = new Set(["scotland", "wales"]);

function priceOf(p: Property): number | null {
  return p.price_gbp?.value ?? null;
}

function score(seed: Property, c: Property): number {
  let s = 0;
  if (seed.postcode_area && c.postcode_area === seed.postcode_area) s += 3;
  if (seed.property_type && c.property_type && c.property_type.toLowerCase() === seed.property_type.toLowerCase()) s += 2;
  const sy = seed.yield_pct?.value;
  const cy = c.yield_pct?.value;
  if (sy != null && cy != null && Math.abs(sy - cy) <= 3) s += 1;
  if (c.price_kind === "achieved") s += 1;
  return s;
}

function fmtGbp(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB");
}

function reason(seed: Property, c: Property, bandPct: number): string {
  const parts: string[] = [`same use (${c.use}) and nation (${c.nation})`];
  if (seed.postcode_area && c.postcode_area === seed.postcode_area) parts.push(`same postcode area ${c.postcode_area}`);
  if (seed.property_type && c.property_type?.toLowerCase() === seed.property_type.toLowerCase()) parts.push(`same type (${c.property_type})`);
  const p = priceOf(c);
  if (p != null) parts.push(`${c.price_kind ?? "price"} ${fmtGbp(p)} within ±${bandPct}% of seed`);
  return `Matched on ${parts.join(", ")}.`;
}

function inBand(seedPrice: number, p: number | null, pct: number): boolean {
  if (p == null) return false;
  return p >= seedPrice * (1 - pct / 100) && p <= seedPrice * (1 + pct / 100);
}

export interface BuildPacketOptions {
  /** Defaults to a stable id derived from the request. */
  id?: string;
}

export function buildPacket(seed: Property, candidates: Property[], req: MatchRequest, opts: BuildPacketOptions = {}): Packet {
  const n = Math.max(1, Math.min(req.n ?? 5, 7)); // packet = seed + up to 7 = 4–8 properties
  const seedPrice = priceOf(seed);
  const minDwellings = req.min_dwellings ?? null;

  const pool = candidates.filter(
    (c) => c.id !== seed.id && c.use === seed.use && c.nation === seed.nation && !SKIP_NATIONS.has(c.nation) && priceOf(c) != null &&
      // Unknown type (blank lot_type) defaults to commercial in mapping; keep it out so packets stay like-for-like.
      c.property_type != null &&
      // Residential packets are dwellings only (no land/sites/garages).
      (seed.use !== "residential" || c.dwellings > 0),
  );

  const rank = (list: Property[]) =>
    list
      .map((c) => ({ c, s: score(seed, c) }))
      .sort((a, b) => b.s - a.s || Math.abs((priceOf(a.c) ?? 0) - (seedPrice ?? 0)) - Math.abs((priceOf(b.c) ?? 0) - (seedPrice ?? 0)) || a.c.id.localeCompare(b.c.id));

  let band = 40;
  let ranked = seedPrice == null ? rank(pool) : rank(pool.filter((c) => inBand(seedPrice, priceOf(c), 40)));
  if (seedPrice != null && ranked.length < n) {
    band = 60;
    ranked = rank(pool.filter((c) => inBand(seedPrice, priceOf(c), 60)));
  }

  const chosen = ranked.slice(0, n);
  const items: PacketItem[] = [
    { property: seed, score: 0, match_reason: "Seed property chosen by the user." },
    ...chosen.map(({ c, s }) => ({ property: c, score: s, match_reason: reason(seed, c, band) })),
  ];

  if (minDwellings != null) {
    const have = new Set(items.map((i) => i.property.id));
    let dwellings = items.reduce((a, i) => a + i.property.dwellings, 0);
    if (dwellings < minDwellings) {
      const extra = rank(
        candidates.filter((c) => !have.has(c.id) && c.use === "residential" && c.dwellings > 0 && !SKIP_NATIONS.has(c.nation) && priceOf(c) != null),
      );
      for (const { c, s } of extra) {
        if (dwellings >= minDwellings) break;
        items.push({ property: c, score: s, match_reason: `Added residential lot to reach ${minDwellings} dwellings for the 6+ homes test.` });
        dwellings += c.dwellings;
      }
    }
  }

  const price = items.reduce((a, i) => a + (priceOf(i.property) ?? 0), 0);
  const rents = items.map((i) => i.property.rent_pa_gbp?.value).filter((x): x is number => x != null);
  const rent = rents.length ? rents.reduce((a, b) => a + b, 0) : null;

  return {
    id: opts.id ?? `pk-${seed.id}-${n}${minDwellings != null ? `-d${minDwellings}` : ""}`,
    seed,
    items,
    totals: {
      price_gbp: price,
      rent_pa_gbp: rent,
      blended_yield_pct: rent != null && price > 0 ? Math.round((rent / price) * 10000) / 100 : null,
      dwellings: items.reduce((a, i) => a + i.property.dwellings, 0),
    },
    criteria: { use: seed.use, nation: seed.nation, price_band_pct: band, n, min_dwellings: minDwellings },
  };
}
