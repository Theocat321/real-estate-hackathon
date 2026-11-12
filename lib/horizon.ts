/**
 * Compare options over a holding period, not just on purchase.
 * Built only from engine rows: yearly charges × years, 10-year trust charges per full decade, and,
 * over a lifetime with a family investing, the inheritance tax A, B and C would pay on a death
 * (the engine's IHT_DEATH_COMPARATOR: 40% above the nil-rate band on the family's share of the packet held personally).
 *
 * "On sale" is a separate view (see `saleSaving`): what each option saves when the packet is sold.
 * "25 years, then sell" nets the part of that saving the seller gets back in the price off the 25-year cost.
 */
import type { Assumptions as EngineAssumptions, CostRow, EngineResult, Investor, OptionId } from "@/contracts";

export type Horizon = "purchase" | "10y" | "25y" | "25y_sell" | "sale";
export const HORIZON_LABEL: Record<Horizon, string> = {
  purchase: "On purchase",
  "10y": "10 years",
  "25y": "25 years",
  "25y_sell": "25 years, then sell",
  sale: "On sale",
};
export const HORIZONS: Horizon[] = ["purchase", "10y", "25y", "25y_sell", "sale"];
const YEARS: Record<Horizon, number> = { purchase: 0, "10y": 10, "25y": 25, "25y_sell": 25, sale: 0 };

export interface Assumptions {
  /** Homes let to unconnected tenants: sent to the engine as assumptions.rental_relief (17% SDLT disapplied, ATED nil). */
  rentalRelief: boolean;
  /** Company profits after corporation tax paid out each year: sent to the engine as assumptions.distribute_profits (dividend tax rows). */
  distributeProfits: boolean;
  /** Share (0–1) of the next buyer's stamp-duty saving the seller gets back in the price. */
  saleShare: number;
}
export const DEFAULT_ASSUMPTIONS: Assumptions = { rentalRelief: true, distributeProfits: true, saleShare: 0.5 };

/** The Studio toggles as the engine's `assumptions` input. */
export const toEngineAssumptions = (a: Pick<Assumptions, "rentalRelief" | "distributeProfits">): Required<EngineAssumptions> => ({
  rental_relief: a.rentalRelief,
  distribute_profits: a.distributeProfits,
});
/** What every engine caller (Studio, Setup, adviser brief, bot) assumes unless the user changes it. The API itself treats absent as false. */
export const STUDIO_ASSUMPTIONS: Required<EngineAssumptions> = toEngineAssumptions(DEFAULT_ASSUMPTIONS);

/** URL query carrying the assumptions from the Studio to the Setup page, e.g. "relief=1&dividends=1". */
export const assumptionsQuery = (a: EngineAssumptions) => `relief=${a.rental_relief ? 1 : 0}&dividends=${a.distribute_profits ? 1 : 0}`;
/** Reads `assumptionsQuery` back; a missing key falls back to STUDIO_ASSUMPTIONS. */
export function assumptionsFromQuery(q: { get(key: string): string | null }): Required<EngineAssumptions> {
  const flag = (key: string, fallback: boolean) => {
    const v = q.get(key);
    return v === null ? fallback : v === "1";
  };
  return { rental_relief: flag("relief", STUDIO_ASSUMPTIONS.rental_relief), distribute_profits: flag("dividends", STUDIO_ASSUMPTIONS.distribute_profits) };
}
/** The active assumptions in one plain sentence. */
export function assumptionsSentence(a: EngineAssumptions): string {
  const relief = a.rental_relief ? "homes are let to unconnected tenants (rental-business relief)" : "no rental-business relief is claimed";
  const profits = a.distribute_profits ? "profits are paid out each year" : "profits are kept in the company";
  return `Assumes ${relief} and ${profits}.`;
}

export const isFamily = (investors: Investor[]) =>
  investors.some((i) => i.type === "family_office_uk" || i.type === "family_office_nonuk");

export interface Breakdown {
  purchase: number;
  yearly: number;
  tenYear: number;
  death: number;
  /** Price got back on sale, as a negative cost (0 unless selling at the end). */
  sale: number;
  total: number;
  /** Engine rows behind each part, for the source drawer. */
  rows: { purchase: CostRow[]; yearly: CostRow[]; tenYear: CostRow[]; death: CostRow[]; sale: CostRow[] };
  years: number;
  decades: number;
}

const sum = (rs: CostRow[]) => rs.reduce((s, r) => s + r.amount_gbp, 0);

export function breakdown(result: EngineResult, o: OptionId, horizon: Horizon, family: boolean, a: Assumptions = DEFAULT_ASSUMPTIONS): Breakdown {
  const years = YEARS[horizon];
  const decades = Math.floor(years / 10);
  const pick = (opt: OptionId, pred: (r: CostRow) => boolean) => result.rows.filter((r) => r.option === opt && pred(r));
  const purchase = pick(o, (r) => r.stage === "acquire");
  const yearly = years > 0 ? pick(o, (r) => r.stage === "hold") : [];
  const tenYear = decades > 0 ? pick(o, (r) => r.stage === "ten_year") : [];
  // A death within the period: options without a trust are exposed if a family holds them.
  const death = years >= 25 && family && o !== "D" ? pick("D", (r) => r.tax === "IHT_DEATH_COMPARATOR") : [];
  const sold = horizon === "25y_sell" ? saleSaving(result, o) : null;
  const back = sold ? Math.round(sold.saving * a.saleShare) : 0;
  const sale = back > 0 ? -back : 0;
  const saleRows = sale ? [...sold!.rows.direct, ...sold!.rows.sale] : [];
  const b = { purchase: sum(purchase), yearly: sum(yearly) * years, tenYear: sum(tenYear) * decades, death: sum(death), sale };
  return {
    ...b,
    total: b.purchase + b.yearly + b.tenYear + b.death + b.sale,
    rows: { purchase, yearly, tenYear, death, sale: saleRows },
    years,
    decades,
  };
}

export interface SaleSaving {
  /** Stamp duty the next buyer pays if they buy the properties (proxy: option A's purchase SDLT, today's prices). */
  directSdlt: number;
  /** Stamp duty the next buyer pays on this option's sale (0.5% on SPV shares; for A, the same SDLT). */
  saleDuty: number;
  /** directSdlt − saleDuty: what selling this way saves, which a seller can ask for in the price. */
  saving: number;
  rows: { direct: CostRow[]; sale: CostRow[] };
}

/** What selling the packet through option `o` saves the next buyer in stamp duty, versus buying the properties. */
export function saleSaving(result: EngineResult, o: OptionId): SaleSaving {
  const direct = result.rows.filter((r) => r.option === "A" && r.stage === "acquire" && r.tax.startsWith("SDLT"));
  const exit = result.rows.filter((r) => r.option === o && r.stage === "exit");
  const directSdlt = sum(direct);
  // A has no share sale: the buyer buys the properties and pays SDLT in full.
  const sale = o === "A" || exit.length === 0 ? direct : exit;
  const saleDuty = sum(sale);
  return { directSdlt, saleDuty, saving: Math.max(0, directSdlt - saleDuty), rows: { direct, sale } };
}

/** True if any option has an ATED row (charged or relieved to nil), so the relief switch changes something. */
export const paysAted = (result: EngineResult) => result.rows.some((r) => r.tax === "ATED");
