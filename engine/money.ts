/** Tax on an amount across bands. Rates in percent. Result floored to whole pounds. */
export interface Band {
  upTo: number; // inclusive upper bound; Infinity for top band
  ratePct: number;
}

export function banded(amount: number, bands: Band[]): number {
  let lower = 0;
  let pennies = 0; // amount * pct, i.e. hundredths of a pound
  for (const b of bands) {
    if (amount <= lower) break;
    const slice = Math.min(amount, b.upTo) - lower;
    pennies += slice * b.ratePct;
    lower = b.upTo;
  }
  return Math.floor(pennies / 100);
}

export function describeBands(bands: Band[]): string {
  let lower = 0;
  return bands
    .map((b) => {
      const s = b.upTo === Infinity ? `${b.ratePct}% above £${fmt(lower)}` : `${b.ratePct}% to £${fmt(b.upTo)}`;
      lower = b.upTo;
      return s;
    })
    .join(", ");
}

export function fmt(n: number): string {
  return n.toLocaleString("en-GB");
}


