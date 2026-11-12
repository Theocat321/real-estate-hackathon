/**
 * Tax-cliff finder. Looks for thresholds close to the packet where a small change moves the tax a lot,
 * and prices each one by re-running the real engine on a what-if scenario. No estimates of its own:
 * every saving is the difference between two engine runs, so every figure keeps its formula and sources.
 *
 * Cliffs:
 *  - price_threshold: a home priced just over a per-dwelling threshold (company 17% SDLT, ATED bands)
 *  - six_homes:       a residential packet of 2–5 homes that real nearby lots could take to 6+
 *  - two_nil_rate_bands: option D using two settlors' nil-rate bands instead of one
 */
import type { CostRow, EngineResult, OptionId, Property, RuleRef, ScenarioInput, Stage, Structure } from "@/contracts";
import { NONRES_DWELLING_THRESHOLD, buyersOf, runEngine, shortName } from "./index";
import { fmt } from "./money";
import { ATED_BANDS_2026_27, ATED_RULE, ATED_THRESHOLD } from "./rules/ated";
import { DEFAULT_SETTLOR_NRB } from "./rules/iht_base";
import { IHT_ENTRY_RULE } from "./rules/iht_entry";
import { COMPANY_17_THRESHOLD, SDLT_RES_RULE } from "./rules/sdlt_res";
import { SDLT_NONRES_RULE } from "./rules/sdlt_nonres";
import { rentFor } from "./rules/rent";

const OPTIONS: OptionId[] = ["A", "B", "C", "D"];
const PRICED_NATIONS = new Set(["england", "ni"]);
/** Only look at thresholds this close above the current per-home price. */
export const PRICE_WINDOW = 0.1;
/** A price cut is a "cliff" when the SDLT saved is at least this share of the cut (marginal rates are lower). */
const CLIFF_RATIO = 0.2;

export type CliffKind = "price_threshold" | "six_homes" | "two_nil_rate_bands";

export interface StageSaving {
  acquire: number;
  hold: number; // per year
  ten_year: number;
}

export interface Cliff {
  id: string;
  kind: CliffKind;
  title: string;
  detail: string;
  severity: "info" | "review";
  rule: RuleRef;
  /** Positive = cheaper than today. Only options where something changes. */
  savings: Partial<Record<OptionId, StageSaving>>;
  best: { option: OptionId; acquire: number; hold: number; ten_year: number };
  /** Engine rows from the what-if run for the best option, for the source drawer. */
  probe_rows: CostRow[];
  /** Properties the cliff adds (six_homes) — real lots with their own sources. */
  added?: Property[];
}

const sumStage = (r: EngineResult, o: OptionId, s: Stage) => r.totals[o]?.[s] ?? 0;
const short = shortName;

function diff(base: EngineResult, probe: EngineResult): Partial<Record<OptionId, StageSaving>> {
  const out: Partial<Record<OptionId, StageSaving>> = {};
  for (const o of OPTIONS) {
    const s = {
      acquire: sumStage(base, o, "acquire") - sumStage(probe, o, "acquire"),
      hold: sumStage(base, o, "hold") - sumStage(probe, o, "hold"),
      ten_year: sumStage(base, o, "ten_year") - sumStage(probe, o, "ten_year"),
    };
    if (s.acquire !== 0 || s.hold !== 0 || s.ten_year !== 0) out[o] = s;
  }
  return out;
}

/** Largest first-year saving (purchase + one year of holding). */
function bestOf(savings: Partial<Record<OptionId, StageSaving>>): Cliff["best"] | null {
  let best: Cliff["best"] | null = null;
  for (const o of OPTIONS) {
    const s = savings[o];
    if (!s) continue;
    if (!best || s.acquire + s.hold > best.acquire + best.hold) best = { option: o, ...s };
  }
  return best && best.acquire + best.hold + best.ten_year > 0 ? best : null;
}

/** Same structures, different items: replaces property nodes and gives each item the first property's owners and pcts. */
export function withItems(structures: Structure[], items: Property[]): Structure[] {
  return structures.map((s) => {
    const owners = buyersOf(s).map((b) => ({ from: b.node.id, pct: Number((b.share * 100).toFixed(4)) }));
    const keep = s.nodes.filter((n) => n.kind !== "property");
    const props = items.map((p, i) => ({ id: `p${i + 1}`, kind: "property" as const, label: short(p), property_id: p.id }));
    const propIds = new Set(s.nodes.filter((n) => n.kind === "property").map((n) => n.id));
    return {
      ...s,
      nodes: [...keep, ...props],
      edges: [...s.edges.filter((e) => !propIds.has(e.to)), ...props.flatMap((n) => owners.map((o) => ({ from: o.from, to: n.id, pct: o.pct })))],
    };
  });
}

function scenario(input: ScenarioInput, items: Property[], extra: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    ...input,
    ...extra,
    packet: { ...input.packet, items },
    structures: withItems(input.structures, items),
  };
}

/* ───────────────────────── price thresholds ───────────────────────── */

function priceThresholds(): { at: number; why: string; rule: RuleRef }[] {
  return [
    { at: COMPANY_17_THRESHOLD, why: `homes over £${fmt(COMPANY_17_THRESHOLD)} bought by a company pay a flat 17% SDLT, and enter ATED`, rule: SDLT_RES_RULE },
    ...ATED_BANDS_2026_27.slice(0, -1).map((b) => ({ at: b.upTo, why: `the next ATED band starts above £${fmt(b.upTo)}`, rule: ATED_RULE })),
  ].filter((t, i, all) => all.findIndex((x) => x.at === t.at) === i && t.at >= ATED_THRESHOLD);
}

function priceCliffs(input: ScenarioInput, base: EngineResult): Cliff[] {
  const out: Cliff[] = [];
  input.packet.items.forEach((p, idx) => {
    if (p.use !== "residential" || !p.price_gbp || !PRICED_NATIONS.has(p.nation)) return;
    const d = Math.max(1, p.dwellings);
    const per = p.price_gbp.value / d;
    for (const t of priceThresholds()) {
      if (!(per > t.at && per <= t.at * (1 + PRICE_WINDOW))) continue;
      const newPrice = t.at * d;
      const cut = p.price_gbp.value - newPrice;
      const items = input.packet.items.map((q, j) =>
        j === idx
          ? {
              ...q,
              // Paying less doesn't change the rent: pin it at today's figure.
              rent_pa_gbp: q.rent_pa_gbp ?? (() => {
                const r = rentFor(q, q.price_gbp!.value);
                return { value: r.value, source: r.source };
              })(),
              price_gbp: {
                value: newPrice,
                source: { kind: "user" as const, file: "what-if", excerpt: `${short(q)} at £${fmt(newPrice)} instead of £${fmt(q.price_gbp!.value)}` },
              },
            }
          : q,
      );
      const probe = runEngine(scenario(input, items));
      const savings = diff(base, probe);
      const best = bestOf(savings);
      if (!best) continue;
      // Ignore ordinary marginal savings from a lower price; keep real cliffs (big SDLT jump or an annual charge removed).
      if (best.hold <= 0 && best.acquire < cut * CLIFF_RATIO) continue;
      out.push({
        id: `price-${p.id}-${t.at}`,
        kind: "price_threshold",
        title: `Agree £${fmt(newPrice)} for ${short(p)}`,
        detail: `It is £${fmt(p.price_gbp.value)} today, £${fmt(cut)} over a threshold: ${t.why}.`,
        severity: "info",
        rule: t.rule,
        savings,
        best,
        probe_rows: probe.rows.filter((r) => r.option === best.option && r.stage !== "death"),
      });
    }
  });
  return out;
}

/* ───────────────────────── six homes ───────────────────────── */

/** Homes in the packet that count towards the six-dwelling rule. */
export function homesIn(items: Property[]): number {
  return items.filter((p) => p.use === "residential" && p.price_gbp && PRICED_NATIONS.has(p.nation)).reduce((n, p) => n + Math.max(1, p.dwellings), 0);
}

/**
 * Real residential lots from `candidates` that take `items` to `target` homes: same nation,
 * same postcode area first, then closest in price to the packet's homes. Null if not enough.
 */
export function pickTopUp(items: Property[], candidates: Property[], target = NONRES_DWELLING_THRESHOLD): { added: Property[]; homes: number } | null {
  const res = items.filter((p) => p.use === "residential" && p.price_gbp && PRICED_NATIONS.has(p.nation));
  const ref = res.length > 0 ? res : items.filter((p) => p.price_gbp);
  if (ref.length === 0) return null;
  const homes = homesIn(items);
  const need = target - homes;
  if (need <= 0) return { added: [], homes };
  const inPacket = new Set(items.map((p) => p.id));
  const area = ref[0].postcode_area;
  const nation = PRICED_NATIONS.has(ref[0].nation) ? ref[0].nation : "england";
  const typical = res.length > 0 ? res.reduce((s, p) => s + p.price_gbp!.value, 0) / res.length : 300_000;
  const pool = candidates
    .filter((c) => c.use === "residential" && c.price_gbp && !inPacket.has(c.id) && c.nation === nation && c.property_type !== "unknown")
    .filter((c) => !/land|site|garage|ground rent/i.test(c.property_type))
    .sort((a, b) => {
      const byArea = Number(b.postcode_area === area) - Number(a.postcode_area === area);
      return byArea || Math.abs(a.price_gbp!.value - typical) - Math.abs(b.price_gbp!.value - typical);
    });
  const added: Property[] = [];
  let got = 0;
  for (const c of pool) {
    if (got >= need) break;
    added.push(c);
    got += Math.max(1, c.dwellings);
  }
  return got < need ? null : { added, homes: homes + got };
}

function sixHomesCliff(input: ScenarioInput, base: EngineResult, candidates: Property[]): Cliff | null {
  const items = input.packet.items;
  const homes = homesIn(items);
  if (homes < 2 || homes >= NONRES_DWELLING_THRESHOLD) return null;
  if (NONRES_DWELLING_THRESHOLD - homes > 3) return null;
  const pick = pickTopUp(items, candidates);
  if (!pick) return null;
  const { added } = pick;
  const got = pick.homes - homes;

  const combined = runEngine(scenario(input, [...items, ...added]));
  const alone = runEngine(scenario(input, added));
  // Saving = (packet today + the extra lots bought separately) − (all bought together).
  const separate: EngineResult = {
    ...base,
    totals: Object.fromEntries(
      OPTIONS.map((o) => [o, Object.fromEntries((["acquire", "hold", "ten_year"] as Stage[]).map((s) => [s, sumStage(base, o, s) + sumStage(alone, o, s)]))]),
    ) as EngineResult["totals"],
  };
  const savings = diff(separate, combined);
  const best = bestOf(savings);
  if (!best || best.acquire <= 0) return null;
  const addedPrice = added.reduce((s, p) => s + p.price_gbp!.value, 0);
  return {
    id: `six-homes-${added.map((a) => a.id).join("-")}`,
    kind: "six_homes",
    title: `Add ${added.length === 1 ? short(added[0]) : `${added.length} more homes`} to reach six`,
    detail: `Six or more homes bought in one transaction use non-residential SDLT rates. Adding £${fmt(addedPrice)} of real lots from the data takes this packet from ${homes} to ${homes + got} homes. Only applies if all are bought in a single transaction, such as from one seller.`,
    severity: "review",
    rule: SDLT_NONRES_RULE,
    savings,
    best,
    probe_rows: combined.rows.filter((r) => r.option === best.option && r.stage === "acquire"),
    added,
  };
}

/* ───────────────────────── two nil-rate bands (D) ───────────────────────── */

function nilRateBandCliff(input: ScenarioInput, base: EngineResult): Cliff | null {
  if (!input.structures.some((s) => s.option === "D")) return null;
  const nrb = input.settlor_nrb_available_gbp ?? DEFAULT_SETTLOR_NRB;
  const price = input.packet.items.reduce((s, p) => s + (p.price_gbp?.value ?? 0), 0);
  if (price <= nrb) return null;
  const probe = runEngine({ ...input, settlor_nrb_available_gbp: nrb * 2 });
  const savings = diff(base, probe);
  const d = savings.D;
  if (!d || d.acquire <= 0) return null;
  return {
    id: "two-nil-rate-bands",
    kind: "two_nil_rate_bands",
    title: "Use two settlors' nil-rate bands",
    detail: `The trust entry charge is 20% above the settlor's £${fmt(nrb)} nil-rate band. If two family members each settle part, using both bands, less is charged. Each settlor's last 7 years of gifts must be checked.`,
    severity: "review",
    rule: IHT_ENTRY_RULE,
    savings: { D: d },
    best: { option: "D", ...d },
    probe_rows: probe.rows.filter((r) => r.option === "D" && (r.tax === "IHT_ENTRY" || r.tax === "IHT_TEN_YEAR")),
  };
}

/** All cliffs near this scenario, biggest first-year saving first. */
export function findCliffs(input: ScenarioInput, candidates: Property[] = []): Cliff[] {
  const base = runEngine(input);
  const cliffs = [...priceCliffs(input, base), sixHomesCliff(input, base, candidates), nilRateBandCliff(input, base)].filter(
    (c): c is Cliff => c !== null,
  );
  return cliffs.sort((a, b) => b.best.acquire + b.best.hold - (a.best.acquire + a.best.hold));
}
