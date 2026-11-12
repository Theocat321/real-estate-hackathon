import type { RuleRef } from "../types";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";
import { ihtBase, ihtBaseText } from "./iht_base";

export const IHT_TEN_YEAR_RULE: RuleRef = {
  id: "iht_ten_year",
  name: "IHT ten-year (periodic) charge on relevant property trust (max 6%)",
  citation_url: CITE.trustsIht,
  as_of: AS_OF,
};

export function ihtTenYear(packetPrice: number, nrb: number): { amount: number; formula: string } {
  const amount = Math.floor((ihtBase(packetPrice, nrb) * 6) / 100);
  return {
    amount,
    formula: `${ihtBaseText(packetPrice, nrb)}; x 6% = £${fmt(amount)} (maximum rate; reliefs and time-apportionment usually make it lower)`,
  };
}
