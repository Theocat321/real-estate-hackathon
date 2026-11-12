import type { RuleRef } from "@/contracts";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";
import { ihtBase, ihtBaseText } from "./iht_base";

export const IHT_ENTRY_RULE: RuleRef = {
  id: "iht_entry",
  citation_url: CITE.trustsIht,
  as_of: AS_OF,
};

export function ihtEntry(packetPrice: number, nrb: number, label?: string): { amount: number; formula: string } {
  const amount = Math.floor((ihtBase(packetPrice, nrb) * 20) / 100);
  return { amount, formula: `${ihtBaseText(packetPrice, nrb, label)}; x 20% = £${fmt(amount)}` };
}
