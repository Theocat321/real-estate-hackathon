/**
 * Deterministic packet builder (BRIEF section 1, step 5). Pure: no I/O, no LLM.
 */
import type { MatchRequest, Packet, Property, Use } from "@/contracts";
import { isNonDwellingLot, UNKNOWN_TYPE } from "./index";

const SKIP_NATIONS = new Set(["scotland", "wales"]);

const priceOf = (p: Property): number | null => p.price_gbp?.value ?? null;

function score(seed: Property, c: Property): number {
  let s = 0;
  if (seed.postcode_area && c.postcode_area === seed.postcode_area) s += 3;
  if (seed.property_type !== UNKNOWN_TYPE && c.property_type.toLowerCase() === seed.property_type.toLowerCase()) s += 2;
  const sy = seed.yield_pct?.value;
  const cy = c.yield_pct?.value;
  if (sy != null && cy != null && Math.abs(sy - cy) <= 3) s += 1;
  if (c.price_kind === "achieved") s += 1;
  return s;
}

function inBand(seedPrice: number, p: number | null, pct: number): boolean {
  return p != null && p >= seedPrice * (1 - pct / 100) && p <= seedPrice * (1 + pct / 100);
}

/** Eligible for a packet: priced, England/NI, known type, and (if residential) an actual home. */
function eligible(c: Property): boolean {
  return (
    priceOf(c) != null &&
    !SKIP_NATIONS.has(c.nation) &&
    c.property_type !== UNKNOWN_TYPE &&
    (c.use !== "residential" || !isNonDwellingLot(c))
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildPacket(seed: Property, candidates: Property[], req: MatchRequest): Packet {
  const n = Math.max(1, Math.min(req.n ?? 5, 8)); // n includes the seed; packets are 4–8
  const use: Use = req.use ?? seed.use;
  const seedPrice = priceOf(seed);
  const minDwellings = req.min_dwellings ?? null;
  const want = n - 1;

  const pool = candidates.filter((c) => c.id !== seed.id && c.use === use && c.nation === seed.nation && eligible(c));
  const rank = (list: Property[]) =>
    list
      .map((c) => ({ c, s: score(seed, c) }))
      .sort(
        (a, b) =>
          b.s - a.s ||
          Math.abs((priceOf(a.c) ?? 0) - (seedPrice ?? 0)) - Math.abs((priceOf(b.c) ?? 0) - (seedPrice ?? 0)) ||
          a.c.id.localeCompare(b.c.id),
      );

  let band = 40;
  let ranked = seedPrice == null ? rank(pool) : rank(pool.filter((c) => inBand(seedPrice, priceOf(c), 40)));
  if (seedPrice != null && ranked.length < want) {
    band = 60;
    ranked = rank(pool.filter((c) => inBand(seedPrice, priceOf(c), 60)));
  }

  const items: Property[] = [seed, ...ranked.slice(0, want).map((r) => r.c)];
  let toppedUp = 0;

  if (minDwellings != null) {
    const have = new Set(items.map((i) => i.id));
    let dwellings = items.reduce((a, i) => a + i.dwellings, 0);
    if (dwellings < minDwellings) {
      const extra = candidates.filter((c) => !have.has(c.id) && c.use === "residential" && c.nation === seed.nation && eligible(c));
      // Prefer homes in the price band, then the rest.
      const inB = seedPrice == null ? [] : rank(extra.filter((c) => inBand(seedPrice, priceOf(c), band)));
      const inBIds = new Set(inB.map((r) => r.c.id));
      const rest = rank(extra.filter((c) => !inBIds.has(c.id)));
      for (const { c } of [...inB, ...rest]) {
        if (dwellings >= minDwellings) break;
        items.push(c);
        dwellings += c.dwellings;
        toppedUp++;
      }
    }
  }

  const price = items.reduce((a, i) => a + (priceOf(i) ?? 0), 0);
  const rent = items.reduce((a, i) => a + (i.rent_pa_gbp?.value ?? 0), 0);
  // Yield only over lots with both rent and price, so unrented lots don't dilute it.
  const both = items.filter((i) => i.rent_pa_gbp != null && priceOf(i) != null);
  const bothRent = both.reduce((a, i) => a + (i.rent_pa_gbp?.value ?? 0), 0);
  const bothPrice = both.reduce((a, i) => a + (priceOf(i) ?? 0), 0);
  const sameArea = items.filter((i) => i.id !== seed.id && seed.postcode_area && i.postcode_area === seed.postcode_area).length;

  const match_reason =
    `${plural(items.length - 1, "lot")} matched to ${seed.id} on ${use} use in ${seed.nation}, ` +
    `priced within ±${band}% of ${seedPrice != null ? "£" + seedPrice.toLocaleString("en-GB") : "the seed"}` +
    (sameArea ? `, ${sameArea} in postcode area ${seed.postcode_area}` : "") +
    (toppedUp ? `, plus ${plural(toppedUp, "residential lot")} added to reach ${minDwellings} dwellings` : "") +
    ".";

  return {
    id: `pk-${seed.id}-n${n}${use !== seed.use ? `-${use}` : ""}${minDwellings != null ? `-d${minDwellings}` : ""}`,
    seed_id: seed.id,
    items,
    totals: {
      price_gbp: price,
      rent_pa_gbp: rent,
      blended_yield_pct: bothPrice > 0 ? Math.round((bothRent / bothPrice) * 10000) / 100 : null,
      dwellings: items.reduce((a, i) => a + i.dwellings, 0),
    },
    match_reason,
  };
}
