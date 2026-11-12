import type { RuleRef } from "@/contracts";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";

export const CORP_TAX_RULE: RuleRef = { id: "corp_tax_rent", citation_url: CITE.corpTax, as_of: AS_OF };
export const PENSION_EXEMPT_RULE: RuleRef = { id: "pension_exempt", citation_url: CITE.pensionExempt, as_of: AS_OF };

export const SMALL_PROFITS_LIMIT = 50_000;
export const MAIN_RATE_LIMIT = 250_000;
export const SMALL_RATE = 0.19;
export const MAIN_RATE = 0.25;
/** Marginal relief fraction between the limits. */
export const MR_FRACTION = 3 / 200;

/**
 * Corporation tax a year on a company's rental profit, with marginal relief. Both limits are divided by
 * (associated companies + 1). With none, the formula is unchanged.
 */
export function corpTax(profit: number, associated = 0): { amount: number; formula: string } {
  const p = Math.max(0, Math.round(profit));
  const div = associated + 1;
  const lower = SMALL_PROFITS_LIMIT / div;
  const upper = MAIN_RATE_LIMIT / div;
  const note = associated > 0 ? `; limits shared with ${associated} associated ${associated === 1 ? "company" : "companies"}` : "";
  if (p <= lower) {
    const amount = Math.round(p * SMALL_RATE);
    return { amount, formula: `£${fmt(p)} profit, not over £${fmt(lower)}: 19% = £${fmt(amount)} a year${note}` };
  }
  if (p >= upper) {
    const amount = Math.round(p * MAIN_RATE);
    return { amount, formula: `£${fmt(p)} profit, over £${fmt(upper)}: 25% = £${fmt(amount)} a year${note}` };
  }
  const relief = Math.round((upper - p) * MR_FRACTION);
  const amount = Math.round(p * MAIN_RATE) - relief;
  return {
    amount,
    formula: `£${fmt(p)} profit x 25% = £${fmt(Math.round(p * MAIN_RATE))}, less marginal relief (£${fmt(upper)} - £${fmt(p)}) x 3/200 = £${fmt(relief)}: £${fmt(amount)} a year${note}`,
  };
}
