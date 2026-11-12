import type { RuleRef } from "../types";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";
import { ihtBase, ihtBaseText } from "./iht_base";

export const IHT_DEATH_COMPARATOR_RULE: RuleRef = {
  id: "iht_death_comparator",
  name: "IHT on death if held personally (40%) - comparator",
  citation_url: CITE.trustsIht,
  as_of: AS_OF,
};

/** What the family would pay holding personally. A comparator, not a cost of option D. */
export function ihtDeathComparator(packetPrice: number, nrb: number): { amount: number; formula: string } {
  const amount = Math.floor((ihtBase(packetPrice, nrb) * 40) / 100);
  return {
    amount,
    formula: `${ihtBaseText(packetPrice, nrb)}; x 40% = £${fmt(amount)} (comparator: IHT if the family held personally; not a cost of D)`,
  };
}
