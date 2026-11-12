import type { Packet, Property } from "@/contracts";
import { NONRES_DWELLING_THRESHOLD } from "@/engine";
import { pickTopUp } from "@/engine/cliffs";
import { matchCandidates } from "@/lib/db";

export const runtime = "nodejs";

function totals(items: Property[]): Packet["totals"] {
  const price = items.reduce((s, p) => s + (p.price_gbp?.value ?? 0), 0);
  const both = items.filter((p) => p.price_gbp && p.rent_pa_gbp);
  const bp = both.reduce((s, p) => s + p.price_gbp!.value, 0);
  const br = both.reduce((s, p) => s + p.rent_pa_gbp!.value, 0);
  return {
    price_gbp: price,
    rent_pa_gbp: items.reduce((s, p) => s + (p.rent_pa_gbp?.value ?? 0), 0),
    blended_yield_pct: bp > 0 ? Math.round((br / bp) * 10000) / 100 : null,
    dwellings: items.reduce((s, p) => s + p.dwellings, 0),
  };
}

/** POST /api/topup  { packet } → Packet with real residential lots added to reach six homes. */
export async function POST(req: Request): Promise<Response> {
  let packet: Packet;
  try {
    packet = ((await req.json()) as { packet: Packet }).packet;
    if (!packet?.items?.length) throw new Error();
  } catch {
    return Response.json({ error: "Body must be { packet } with at least one property" }, { status: 400 });
  }
  const anchor = packet.items.find((p) => p.use === "residential") ?? packet.items[0];
  const candidates = await matchCandidates({ ...anchor, use: "residential" });
  const pick = pickTopUp(packet.items, candidates);
  if (!pick) return Response.json({ error: "Not enough comparable homes in the data to reach six." }, { status: 422 });
  if (pick.added.length === 0) return Response.json(packet);
  const items = [...packet.items, ...pick.added];
  const n = pick.added.length;
  const result: Packet = {
    ...packet,
    id: `${packet.id}-6h`,
    items,
    totals: totals(items),
    match_reason: `${packet.match_reason} Plus ${n} residential lot${n > 1 ? "s" : ""} from the data to reach ${NONRES_DWELLING_THRESHOLD} homes.`,
  };
  return Response.json(result);
}
