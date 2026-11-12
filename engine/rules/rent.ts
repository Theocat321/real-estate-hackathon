import type { Property, SourceRef, Use } from "@/contracts";
import { fmt } from "../money";

/** Typical gross yields used only when a lot has neither a stated rent nor a stated yield. */
export const DEFAULT_GROSS_YIELD_PCT: Record<Use, number> = { residential: 5, commercial: 6.5, mixed: 6 };

/** Share of rent left as taxable profit after running costs (management, repairs, voids, insurance). No loan interest. */
export const PROFIT_SHARE_OF_RENT = 0.75;

export interface Rent {
  value: number;
  source: SourceRef;
  estimated: boolean;
}

/** Rent a year for one lot: stated rent, else price x stated yield, else price x typical yield for its use. */
export function rentFor(p: Property, price: number): Rent {
  if (p.rent_pa_gbp) return { value: Math.round(p.rent_pa_gbp.value), source: p.rent_pa_gbp.source, estimated: false };
  if (p.yield_pct) {
    return {
      value: Math.round((price * p.yield_pct.value) / 100),
      source: { ...p.yield_pct.source, excerpt: `£${fmt(price)} x stated yield ${p.yield_pct.value}%` },
      estimated: false,
    };
  }
  const y = DEFAULT_GROSS_YIELD_PCT[p.use];
  return {
    value: Math.round((price * y) / 100),
    source: { kind: "rule", file: "engine/rules/rent.ts", excerpt: `Estimated: no rent in the data, so £${fmt(price)} x typical ${p.use} gross yield ${y}%` },
    estimated: true,
  };
}
