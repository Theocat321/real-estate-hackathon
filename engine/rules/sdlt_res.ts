import type { RuleRef } from "../types";
import { banded, describeBands, fmt, type Band } from "../money";
import { AS_OF, CITE } from "./citations";

export const SDLT_RES_RULE: RuleRef = {
  id: "sdlt_res",
  name: "SDLT residential: higher rates / 17% company rate",
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
 */
export function sdltRes(price: number, dwellings: number, buyerIsCompany: boolean): SdltResResult {
  const perDwelling = price / dwellings;
  if (buyerIsCompany && perDwelling > COMPANY_17_THRESHOLD) {
    const amount = Math.floor((price * COMPANY_17_PCT) / 100);
    return {
      tax: "SDLT_RES_COMPANY_17",
      amount,
      formula: `£${fmt(price)} x ${COMPANY_17_PCT}% flat (company buyer, dwelling price over £${fmt(COMPANY_17_THRESHOLD)}) = £${fmt(amount)}`,
    };
  }
  const amount = banded(price, SDLT_RES_HIGHER_BANDS);
  return {
    tax: "SDLT_RES_HIGHER",
    amount,
    formula: `SDLT residential higher rates on £${fmt(price)} (standard bands +${HIGHER_RATES_SURCHARGE_PCT} points): ${describeBands(SDLT_RES_HIGHER_BANDS)} = £${fmt(amount)}`,
  };
}
