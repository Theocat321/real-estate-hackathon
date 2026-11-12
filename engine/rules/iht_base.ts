import { fmt } from "../money";

export const DEFAULT_SETTLOR_NRB = 325_000;

/** Chargeable base shared by the trust IHT rules. */
export const ihtBase = (packetPrice: number, nrb: number) => Math.max(0, packetPrice - nrb);
export const ihtBaseText = (packetPrice: number, nrb: number) =>
  `max(0, £${fmt(packetPrice)} packet price - £${fmt(nrb)} settlor nil-rate band available) = £${fmt(ihtBase(packetPrice, nrb))}`;
