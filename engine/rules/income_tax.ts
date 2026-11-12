import type { RuleRef } from "@/contracts";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";

export const INCOME_TAX_RULE: RuleRef = { id: "income_tax_rent", citation_url: CITE.incomeTax, as_of: AS_OF };

/** Property income additional rate, 2026-27. */
export const PROPERTY_ADDITIONAL_RATE = 0.45;

/** Income tax a year on an individual's (or family's) rental profit, at the additional rate. Rounded down. */
export function incomeTaxOnRent(profit: number): { amount: number; formula: string } {
  const p = Math.max(0, Math.round(profit));
  const amount = Math.floor(p * PROPERTY_ADDITIONAL_RATE);
  return {
    amount,
    formula: `£${fmt(p)} profit x 45% additional rate = £${fmt(amount)} a year (assumes other income already uses the lower bands)`,
  };
}
