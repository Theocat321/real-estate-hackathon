import type { RuleRef } from "@/contracts";
import { fmt } from "../money";
import { AS_OF, CITE } from "./citations";

export const ATED_RULE: RuleRef = {
  id: "ated",
  citation_url: CITE.ated,
  as_of: AS_OF,
};

export const ATED_THRESHOLD = 500_000;

/** 2026/27 annual chargeable amounts. `upTo` inclusive. */
export const ATED_BANDS_2026_27: { upTo: number; charge: number; label: string }[] = [
  { upTo: 1_000_000, charge: 4_600, label: "£500k-£1m" },
  { upTo: 2_000_000, charge: 9_450, label: "£1m-£2m" },
  { upTo: 5_000_000, charge: 32_200, label: "£2m-£5m" },
  { upTo: 10_000_000, charge: 75_450, label: "£5m-£10m" },
  { upTo: 20_000_000, charge: 151_450, label: "£10m-£20m" },
  { upTo: Infinity, charge: 303_450, label: "over £20m" },
];

export const ATED_FLAG =
  "ATED: property-rental-business relief can reduce the charge to nil, but an ATED return (relief declaration) is still required each year.";

/** Annual ATED for `dwellings` dwellings each valued at `price / dwellings`. Zero if at or below £500k. */
export function ated(price: number, dwellings: number): { amount: number; formula: string } {
  const perDwelling = price / dwellings;
  if (perDwelling <= ATED_THRESHOLD) {
    return { amount: 0, formula: `£${fmt(perDwelling)} per dwelling is not over £${fmt(ATED_THRESHOLD)}: no ATED` };
  }
  const band = ATED_BANDS_2026_27.find((b) => perDwelling <= b.upTo)!;
  const amount = band.charge * dwellings;
  const per = dwellings > 1 ? ` x ${dwellings} dwellings` : "";
  return {
    amount,
    formula: `£${fmt(perDwelling)} per dwelling falls in ${band.label} band: £${fmt(band.charge)} a year${per} = £${fmt(amount)} a year`,
  };
}
