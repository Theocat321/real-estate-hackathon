/**
 * Packet optimiser. Chooses which lots to buy (from the packet plus nearby candidates) and how to split
 * them into separate purchases, each with its own ownership structure, to minimise tax as a share of price.
 *
 * Exact, not heuristic: every group of lots is priced with the real engine for each structure, then a
 * dynamic programme over subsets finds the cheapest split. Rules it respects:
 *  - Six-or-more-homes non-residential rates only apply when `sameSeller` (one transaction); otherwise each
 *    lot's SDLT is priced on its own.
 *  - At most one family trust (one settlor's nil-rate band), and only when a family is investing.
 *  - Cost = tax on purchase + yearly charges over `horizonYears` (+ 10-year trust charges inside the horizon).
 *    Exit costs are excluded: a share sale also saves the next buyer SDLT, which the engine doesn't model.
 *    Structure set-up and running fees are not included.
 */
import type { Investor, OptionId, Property, ScenarioInput, Structure } from "@/contracts";
import { runEngine } from "./index";

export type StructureBuilder = (items: Property[], option: OptionId, investors: Investor[]) => Structure;

export interface PlanGroup {
  option: OptionId;
  item_ids: string[];
  price: number;
  acquire: number;
  hold_pa: number;
  ten_year: number;
  cost: number;
}

export interface Plan {
  groups: PlanGroup[];
  item_ids: string[];
  price: number;
  cost: number;
  rate_pct: number;
}

export interface OptimiseOptions {
  sameSeller: boolean;
  keepAll: boolean;
  horizonYears?: number;
  minLots?: number;
  maxLots?: number;
  maxGroups?: number;
}

export interface OptimiseResult {
  best: Plan;
  /** Cheapest way to buy the same lots through one structure. */
  single: Plan;
  /** Today's packet through its cheapest single structure, for comparison. */
  current: Plan;
  added: Property[];
  left_out: Property[];
  options: OptionId[];
  horizon_years: number;
  same_seller: boolean;
  engine_runs: number;
}

const MAX_POOL = 12;

export function optimise(
  packetItems: Property[],
  candidates: Property[],
  investors: Investor[],
  build: StructureBuilder,
  opts: OptimiseOptions,
): OptimiseResult {
  const H = opts.horizonYears ?? 5;
  const minLots = opts.minLots ?? 4;
  const maxLots = opts.maxLots ?? 8;
  const maxGroups = opts.maxGroups ?? 3;
  const family = investors.some((i) => i.type === "family_office_uk" || i.type === "family_office_nonuk");
  const options: OptionId[] = family ? ["A", "B", "C", "D"] : ["A", "B", "C"];

  const items = packetItems.filter((p) => p.price_gbp);
  const extra = candidates.filter((c) => c.price_gbp && !items.some((p) => p.id === c.id)).slice(0, Math.max(0, MAX_POOL - items.length));
  const pool = [...items, ...extra];
  const n = pool.length;
  const FULL = (1 << n) - 1;
  const price = (m: number) => pool.reduce((s, p, i) => (m & (1 << i) ? s + p.price_gbp!.value : s), 0);
  const ids = (m: number) => pool.filter((_, i) => m & (1 << i)).map((p) => p.id);
  const bits = (m: number) => {
    let c = 0;
    for (let x = m; x; x &= x - 1) c++;
    return c;
  };
  let runs = 0;

  const scenario = (lots: Property[], option: OptionId): ScenarioInput => ({
    packet: { id: "opt", seed_id: lots[0].id, items: lots, totals: { price_gbp: 0, rent_pa_gbp: 0, blended_yield_pct: null, dwellings: 0 }, match_reason: "" },
    structures: [build(lots, option, investors)],
    investors,
  });
  const sdltOf = (r: ReturnType<typeof runEngine>, o: OptionId) =>
    r.rows.filter((x) => x.option === o && x.stage === "acquire" && x.tax.startsWith("SDLT")).reduce((s, x) => s + x.amount_gbp, 0);

  // SDLT of each lot bought on its own, per structure (used when lots are separate transactions).
  const singleSdlt = pool.map((p) =>
    Object.fromEntries(
      options.map((o) => {
        runs++;
        return [o, sdltOf(runEngine(scenario([p], o)), o)];
      }),
    ) as Record<OptionId, number>,
  );

  // Price every group with every structure.
  const groupCost = new Map<number, Record<string, PlanGroup>>();
  const costOf = (m: number, o: OptionId): PlanGroup => {
    let rec = groupCost.get(m);
    if (!rec) groupCost.set(m, (rec = {}));
    if (rec[o]) return rec[o];
    const lots = pool.filter((_, i) => m & (1 << i));
    runs++;
    const r = runEngine(scenario(lots, o));
    const t = r.totals[o] ?? {};
    let acquire = t.acquire ?? 0;
    if (!opts.sameSeller && lots.length > 1) {
      acquire = acquire - sdltOf(r, o) + lots.reduce((s, p) => s + singleSdlt[pool.indexOf(p)][o], 0);
    }
    const hold = t.hold ?? 0;
    const ten = t.ten_year ?? 0;
    const g: PlanGroup = {
      option: o,
      item_ids: ids(m),
      price: price(m),
      acquire,
      hold_pa: hold,
      ten_year: ten,
      cost: acquire + hold * H + ten * Math.floor(H / 10),
    };
    rec[o] = g;
    return g;
  };

  // Best non-trust structure per group, and the trust option.
  const best1: (PlanGroup | null)[] = new Array(FULL + 1).fill(null);
  const bestD: (PlanGroup | null)[] = new Array(FULL + 1).fill(null);
  for (let m = 1; m <= FULL; m++) {
    for (const o of options) {
      const g = costOf(m, o);
      if (o === "D") bestD[m] = g;
      else if (!best1[m] || g.cost < best1[m]!.cost) best1[m] = g;
    }
  }

  // dp[k][d][m]: cheapest split of m into k groups, d = uses the one trust group.
  type Cell = { cost: number; first: PlanGroup; rest: number } | null;
  const dp: Cell[][][] = Array.from({ length: maxGroups + 1 }, () => [new Array(FULL + 1).fill(null), new Array(FULL + 1).fill(null)]);
  for (let m = 1; m <= FULL; m++) {
    dp[1][0][m] = { cost: best1[m]!.cost, first: best1[m]!, rest: 0 };
    if (bestD[m]) dp[1][1][m] = { cost: bestD[m]!.cost, first: bestD[m]!, rest: 0 };
  }
  for (let k = 2; k <= maxGroups; k++) {
    for (let m = 1; m <= FULL; m++) {
      const low = m & -m;
      for (let s = m; s; s = (s - 1) & m) {
        if (!(s & low) || s === m) continue;
        const rest = m ^ s;
        for (const d of [0, 1] as const) {
          // s is a non-trust group, rest carries the trust flag
          const a = dp[k - 1][d][rest];
          if (a) {
            const c = best1[s]!.cost + a.cost;
            if (!dp[k][d][m] || c < dp[k][d][m]!.cost) dp[k][d][m] = { cost: c, first: best1[s]!, rest };
          }
          // s is the trust group
          if (d === 1 && bestD[s]) {
            const b = dp[k - 1][0][rest];
            if (b) {
              const c = bestD[s]!.cost + b.cost;
              if (!dp[k][1][m] || c < dp[k][1][m]!.cost) dp[k][1][m] = { cost: c, first: bestD[s]!, rest };
            }
          }
        }
      }
    }
  }

  const unwind = (k: number, d: 0 | 1, m: number): PlanGroup[] => {
    const c = dp[k][d][m]!;
    if (k === 1) return [c.first];
    const dRest: 0 | 1 = c.first.option === "D" ? 0 : d;
    return [c.first, ...unwind(k - 1, dRest, c.rest)];
  };
  const bestPlan = (m: number): Plan => {
    let pick: { k: number; d: 0 | 1; cost: number } | null = null;
    for (let k = 1; k <= maxGroups; k++)
      for (const d of [0, 1] as const) {
        const c = dp[k][d][m];
        // prefer fewer groups unless strictly cheaper
        if (c && (!pick || c.cost < pick.cost)) pick = { k, d, cost: c.cost };
      }
    return toPlan(unwind(pick!.k, pick!.d, m), m);
  };
  const singlePlan = (m: number): Plan => {
    const g = [best1[m]!, bestD[m]].filter(Boolean).sort((a, b) => a!.cost - b!.cost)[0]!;
    return toPlan([g], m);
  };
  const toPlan = (groups: PlanGroup[], m: number): Plan => {
    const p = price(m);
    const cost = groups.reduce((s, g) => s + g.cost, 0);
    return { groups: groups.sort((a, b) => b.item_ids.length - a.item_ids.length), item_ids: ids(m), price: p, cost, rate_pct: p > 0 ? (cost / p) * 100 : 0 };
  };

  // Which lots to buy: lowest tax as a share of price, inside the size limits.
  const itemsMask = (1 << items.length) - 1;
  const required = opts.keepAll ? itemsMask : 1; // keep all lots, or at least the seed
  let chosen = itemsMask;
  let chosenPlan: Plan | null = null;
  for (let m = 1; m <= FULL; m++) {
    if ((m & required) !== required) continue;
    if (opts.keepAll && m !== itemsMask) continue; // keep exactly the packet's lots
    const c = bits(m);
    const lo = Math.min(minLots, bits(required) || 1);
    const hi = Math.max(maxLots, bits(required));
    if (c < lo || c > hi) continue;
    const plan = bestPlan(m);
    if (!chosenPlan || plan.rate_pct < chosenPlan.rate_pct - 1e-9 || (Math.abs(plan.rate_pct - chosenPlan.rate_pct) < 1e-9 && c > bits(chosen))) {
      chosenPlan = plan;
      chosen = m;
    }
  }

  return {
    best: chosenPlan!,
    single: singlePlan(chosen),
    current: singlePlan(itemsMask),
    added: pool.filter((_, i) => i >= items.length && chosen & (1 << i)),
    left_out: items.filter((_, i) => !(chosen & (1 << i))),
    options,
    horizon_years: H,
    same_seller: opts.sameSeller,
    engine_runs: runs,
  };
}
