import type { RuleRef } from "@/contracts";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";

export const DIVIDEND_TAX_RULE: RuleRef = { id: "dividend_tax", citation_url: CITE.dividendTax, as_of: AS_OF };
/** Trust rows cite the trusts and income tax guidance (dividend trust rate). */
export const DIVIDEND_TAX_TRUST_RULE: RuleRef = { ...DIVIDEND_TAX_RULE, citation_url: CITE.trustIncomeTax };

/** Dividend additional rate and dividend trust rate, 2026-27. */
export const DIVIDEND_ADDITIONAL_RATE = 0.3935;
export const DIVIDEND_TRUST_RATE = 0.3935;

export type DividendRecipient = "individual" | "trust" | "uk_company" | "pension" | "non_uk";

export const dividendRuleFor = (recipient: DividendRecipient): RuleRef => (recipient === "trust" ? DIVIDEND_TAX_TRUST_RULE : DIVIDEND_TAX_RULE);

/** UK tax a year on a dividend, by who receives it. Rounded down. */
export function dividendTax(dividend: number, recipient: DividendRecipient): { amount: number; formula: string } {
  const d = Math.max(0, Math.round(dividend));
  const at = (rate: number, text: string) => {
    const amount = Math.floor(d * rate);
    return { amount, formula: `£${fmt(d)} dividend x 39.35% ${text} = £${fmt(amount)} a year` };
  };
  switch (recipient) {
    case "individual":
      return at(DIVIDEND_ADDITIONAL_RATE, "additional dividend rate (assumes other income already uses the lower bands)");
    case "trust":
      return at(DIVIDEND_TRUST_RATE, "dividend trust rate");
    case "uk_company":
      return { amount: 0, formula: `£${fmt(d)} dividend to a company: exempt from corporation tax (dividend exemption) = £0` };
    case "pension":
      return { amount: 0, formula: `£${fmt(d)} dividend to a registered pension scheme: exempt = £0` };
    case "non_uk":
      return { amount: 0, formula: `£${fmt(d)} dividend to a non-UK resident: no UK tax on dividends to non-residents = £0` };
  }
}
