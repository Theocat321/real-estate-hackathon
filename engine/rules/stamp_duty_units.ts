import type { RuleRef } from "@/contracts";
import { AS_OF, CITE } from "./citations";

export const STAMP_DUTY_UNITS_RULE: RuleRef = {
  id: "stamp_duty_units",
  citation_url: CITE.rifUnits,
  as_of: AS_OF,
};

export const STAMP_DUTY_UNITS_FLAG =
  "Selling fund units instead of company shares: no stamp duty, unless avoiding it is a main purpose of the arrangements.";

/**
 * Stamp duty on a sale of units in the fund that owns PropCo. Always nil:
 * - UK Reserved Investor Fund: transfers of units exempt from stamp duty and SDRT (SI 2025/200 regs 50-51).
 * - Non-UK unit trust (e.g. JPUT) with its register outside the UK: units are not UK securities.
 */
export function stampDutyUnits(fundLabel: string, jurisdiction: string | undefined): { amount: number; formula: string } {
  const why =
    jurisdiction && jurisdiction !== "UK"
      ? `units in a ${jurisdiction} unit trust registered outside the UK are not UK securities: no UK stamp duty or SDRT`
      : "transfers of Reserved Investor Fund units are exempt from stamp duty and SDRT (SI 2025/200)";
  return { amount: 0, formula: `Sale of ${fundLabel} units: ${why} = £0` };
}
