import type { RuleRef } from "../types";
import { banded, describeBands, fmt, type Band } from "../money";
import { AS_OF, CITE } from "./citations";

export const SDLT_NONRES_RULE: RuleRef = {
  id: "sdlt_nonres",
  name: "SDLT non-residential / mixed-use rates",
  citation_url: CITE.sdlt,
  as_of: AS_OF,
};

export const SDLT_NONRES_BANDS: Band[] = [
  { upTo: 150_000, ratePct: 0 },
  { upTo: 250_000, ratePct: 2 },
  { upTo: Infinity, ratePct: 5 },
];

/** Applies to commercial/mixed use, or a residential purchase of 6+ dwellings in one transaction. */
export function sdltNonRes(price: number): { amount: number; formula: string } {
  const amount = banded(price, SDLT_NONRES_BANDS);
  return {
    amount,
    formula: `SDLT non-residential on £${fmt(price)}: ${describeBands(SDLT_NONRES_BANDS)} = £${fmt(amount)}`,
  };
}
