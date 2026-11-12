import type { RuleRef } from "@/contracts";
import { banded, describeBands, fmt, type Band } from "../money";
import { AS_OF, CITE } from "./citations";

export const SDLT_RES_RULE: RuleRef = {
  id: "sdlt_res",
  citation_url: CITE.sdlt,
  as_of: AS_OF,
};

export const SDLT_RES_STANDARD_BANDS: Band[] = [
  { upTo: 125_000, ratePct: 0 },
  { upTo: 250_000, ratePct: 2 },
  { upTo: 925_000, ratePct: 5 },
  { upTo: 1_500_000, ratePct: 10 },
  { upTo: Infinity, ratePct: 12 },
];
export const HIGHER_RATES_SURCHARGE_PCT = 5;
export const SDLT_RES_HIGHER_BANDS: Band[] = SDLT_RES_STANDARD_BANDS.map((b) => ({
  upTo: b.upTo,
  ratePct: b.ratePct + HIGHER_RATES_SURCHARGE_PCT,
}));
export const COMPANY_17_THRESHOLD = 500_000;
export const COMPANY_17_PCT = 17;
/** Extra percentage points for a non-UK resident buyer (rates-of-stamp-duty-land-tax-for-non-uk-residents). */
export const NON_UK_SURCHARGE_PCT = 2;

export type SdltResResult = {
  tax: "SDLT_RES_COMPANY_17" | "SDLT_RES_HIGHER";
  amount: number;
  formula: string;
};

/**
 * Residential purchase (packet under 6 dwellings).
 * @param price total price of the property
 * @param dwellings number of dwellings in it (per-dwelling price = price / dwellings)
 * @param buyerIsCompany non-natural person buyer
 * @param buyerIsNonUk non-UK resident buyer (adds the 2% surcharge)
 */
export function sdltRes(price: number, dwellings: number, buyerIsCompany: boolean, buyerIsNonUk = false): SdltResResult {
  const perDwelling = price / dwellings;
  const extra = buyerIsNonUk ? NON_UK_SURCHARGE_PCT : 0;
  const nonUkNote = buyerIsNonUk ? ` incl. ${NON_UK_SURCHARGE_PCT}% non-UK resident surcharge` : "";
  if (buyerIsCompany && perDwelling > COMPANY_17_THRESHOLD) {
    const pct = COMPANY_17_PCT + extra;
    const amount = Math.floor((price * pct) / 100);
    return {
      tax: "SDLT_RES_COMPANY_17",
      amount,
      formula: `£${fmt(price)} x ${pct}% flat (company buyer, dwelling price over £${fmt(COMPANY_17_THRESHOLD)}${nonUkNote}) = £${fmt(amount)}`,
    };
  }
  const bands = extra ? SDLT_RES_HIGHER_BANDS.map((b) => ({ upTo: b.upTo, ratePct: b.ratePct + extra })) : SDLT_RES_HIGHER_BANDS;
  const amount = banded(price, bands);
  return {
    tax: "SDLT_RES_HIGHER",
    amount,
    formula: `SDLT residential higher rates on £${fmt(price)} (standard bands +${HIGHER_RATES_SURCHARGE_PCT + extra} points${nonUkNote}): ${describeBands(bands)} = £${fmt(amount)}`,
  };
}
