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

/** Corporation tax a year on a company's rental profit, with marginal relief. One company, no associated companies. */
export function corpTax(profit: number): { amount: number; formula: string } {
  const p = Math.max(0, Math.round(profit));
  if (p <= SMALL_PROFITS_LIMIT) {
    const amount = Math.round(p * SMALL_RATE);
    return { amount, formula: `£${fmt(p)} profit, not over £${fmt(SMALL_PROFITS_LIMIT)}: 19% = £${fmt(amount)} a year` };
  }
  if (p >= MAIN_RATE_LIMIT) {
    const amount = Math.round(p * MAIN_RATE);
    return { amount, formula: `£${fmt(p)} profit, over £${fmt(MAIN_RATE_LIMIT)}: 25% = £${fmt(amount)} a year` };
  }
  const relief = Math.round((MAIN_RATE_LIMIT - p) * MR_FRACTION);
  const amount = Math.round(p * MAIN_RATE) - relief;
  return {
    amount,
    formula: `£${fmt(p)} profit x 25% = £${fmt(Math.round(p * MAIN_RATE))}, less marginal relief (£${fmt(MAIN_RATE_LIMIT)} - £${fmt(p)}) x 3/200 = £${fmt(relief)}: £${fmt(amount)} a year`,
  };
}
