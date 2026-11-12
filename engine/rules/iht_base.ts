import { fmt } from "../money";

export const DEFAULT_SETTLOR_NRB = 325_000;

/** Chargeable base shared by the trust IHT rules. */
export const ihtBase = (packetPrice: number, nrb: number) => Math.max(0, packetPrice - nrb);
/** `label` names the base: the whole packet price, or the family's share when the trust holds part of PropCo. */
export const ihtBaseText = (packetPrice: number, nrb: number, label = "packet price") =>
  `max(0, £${fmt(packetPrice)} ${label} - £${fmt(nrb)} settlor nil-rate band available) = £${fmt(ihtBase(packetPrice, nrb))}`;
