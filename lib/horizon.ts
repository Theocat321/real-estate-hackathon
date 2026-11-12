/**
 * Compare options over a holding period, not just on purchase.
 * Built only from engine rows: yearly charges × years, 10-year trust charges per full decade, and,
 * over a lifetime with a family investing, the inheritance tax A, B and C would pay on a death
 * (the engine's IHT_DEATH_COMPARATOR: 40% above the nil-rate band on the packet held personally).
 * Exit costs are excluded (a share sale also saves the next buyer SDLT, which isn't modelled).
 */
import type { CostRow, EngineResult, Investor, OptionId } from "@/contracts";

export type Horizon = "purchase" | "10y" | "25y";
export const HORIZON_LABEL: Record<Horizon, string> = { purchase: "On purchase", "10y": "10 years", "25y": "25 years" };
const YEARS: Record<Horizon, number> = { purchase: 0, "10y": 10, "25y": 25 };

export const isFamily = (investors: Investor[]) =>
  investors.some((i) => i.type === "family_office_uk" || i.type === "family_office_nonuk");

export interface Breakdown {
  purchase: number;
  yearly: number;
  tenYear: number;
  death: number;
  total: number;
  /** Engine rows behind each part, for the source drawer. */
  rows: { purchase: CostRow[]; yearly: CostRow[]; tenYear: CostRow[]; death: CostRow[] };
  years: number;
  decades: number;
}

export function breakdown(result: EngineResult, o: OptionId, horizon: Horizon, family: boolean): Breakdown {
  const years = YEARS[horizon];
  const decades = Math.floor(years / 10);
  const pick = (opt: OptionId, pred: (r: CostRow) => boolean) => result.rows.filter((r) => r.option === opt && pred(r));
  const sum = (rs: CostRow[]) => rs.reduce((s, r) => s + r.amount_gbp, 0);
  const purchase = pick(o, (r) => r.stage === "acquire");
  const yearly = years > 0 ? pick(o, (r) => r.stage === "hold") : [];
  const tenYear = decades > 0 ? pick(o, (r) => r.stage === "ten_year") : [];
  // A death within the period: options without a trust are exposed if a family holds them.
  const death = horizon === "25y" && family && o !== "D" ? pick("D", (r) => r.tax === "IHT_DEATH_COMPARATOR") : [];
  const b = { purchase: sum(purchase), yearly: sum(yearly) * years, tenYear: sum(tenYear) * decades, death: sum(death) };
  return { ...b, total: b.purchase + b.yearly + b.tenYear + b.death, rows: { purchase, yearly, tenYear, death }, years, decades };
}
