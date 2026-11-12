import type { RuleRef } from "@/contracts";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";

export const STAMP_DUTY_SHARES_RULE: RuleRef = {
  id: "stamp_duty_shares",
  citation_url: CITE.shares,
  as_of: AS_OF,
};

export const STAMP_DUTY_SHARES_FLAG =
  "Buyer inherits PropCo's history and the properties' original base cost; assumes a debt-free SPV priced at property value.";

/** 0.5% of share value (proxy: packet total price), rounded UP to the nearest £5. */
export function stampDutyShares(packetPrice: number): { amount: number; formula: string } {
  const raw = packetPrice * 0.005;
  const amount = Math.ceil(raw / 5) * 5;
  return {
    amount,
    formula: `£${fmt(packetPrice)} (packet price, proxy for debt-free SPV share value) x 0.5% = £${fmt(raw)}, rounded up to nearest £5 = £${fmt(amount)}`,
  };
}
