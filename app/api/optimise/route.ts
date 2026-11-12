import type { Investor, OptionId, Packet, Property } from "@/contracts";
import { optimise, type StructureBuilder } from "@/engine/optimise";
import { buildA, buildB, buildC, buildD } from "@/agent/structures";
import { matchCandidates } from "@/lib/db";

export const runtime = "nodejs";

const BUILD: Record<OptionId, (p: Packet, inv: Investor[]) => ReturnType<typeof buildA>> = {
  A: (p, inv) => buildA(p, inv),
  B: (p, inv) => buildB(p, inv),
  C: (p, inv) => buildC(p, inv),
  D: (p, inv) => buildD(p, inv),
};

const builder: StructureBuilder = (items, option, investors) =>
  BUILD[option](
    { id: "opt", seed_id: items[0].id, items, totals: { price_gbp: 0, rent_pa_gbp: 0, blended_yield_pct: null, dwellings: 0 }, match_reason: "" },
    investors,
  );

/** Nearby lots worth considering: same use as the packet's majority, same area first, similar price. */
function rank(items: Property[], pool: Property[], k: number): Property[] {
  const use = items.filter((p) => p.use === "residential").length * 2 >= items.length ? "residential" : items[0].use;
  const area = items[0].postcode_area;
  const priced = items.filter((p) => p.price_gbp);
  const typical = priced.reduce((s, p) => s + p.price_gbp!.value, 0) / Math.max(1, priced.length);
  const ids = new Set(items.map((p) => p.id));
  return pool
    .filter((c) => c.use === use && c.price_gbp && !ids.has(c.id) && c.property_type !== "unknown" && !/land|site|garage|ground rent/i.test(c.property_type))
    .sort((a, b) => Number(b.postcode_area === area) - Number(a.postcode_area === area) || Math.abs(a.price_gbp!.value - typical) - Math.abs(b.price_gbp!.value - typical))
    .slice(0, k);
}

/** POST /api/optimise { packet, investors, same_seller, keep_all } → OptimiseResult */
export async function POST(req: Request): Promise<Response> {
  let body: { packet: Packet; investors?: Investor[]; same_seller?: boolean; keep_all?: boolean };
  try {
    body = await req.json();
    if (!body?.packet?.items?.length) throw new Error();
  } catch {
    return Response.json({ error: "Body must be { packet, investors?, same_seller?, keep_all? }" }, { status: 400 });
  }
  const items = body.packet.items.slice(0, 8);
  const seed = items[0];
  const candidates = rank(items, await matchCandidates(seed).catch(() => []), Math.max(0, 12 - items.length));
  try {
    const result = optimise(items, candidates, body.investors ?? [], builder, {
      sameSeller: !!body.same_seller,
      keepAll: body.keep_all !== false,
    });
    return Response.json({ ...result, candidates });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Optimiser failed" }, { status: 422 });
  }
}
