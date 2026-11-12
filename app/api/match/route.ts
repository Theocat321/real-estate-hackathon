import { NextResponse } from "next/server";
import { z } from "zod";
import { getProperty, matchCandidates } from "@/lib/db";
import { buildPacket } from "@/lib/mapping/match";

const MatchRequest = z.object({
  seed_id: z.string().min(1),
  n: z.number().int().min(1).max(8).optional(),
  use: z.enum(["commercial", "residential", "mixed"]).optional(),
  min_dwellings: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const parsed = MatchRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  try {
    const seed = await getProperty(parsed.data.seed_id);
    if (!seed) return NextResponse.json({ error: `seed ${parsed.data.seed_id} not found` }, { status: 404 });
    if (seed.nation === "scotland" || seed.nation === "wales") {
      return NextResponse.json({ error: `seed is in ${seed.nation}; LBTT/LTT not supported in v1` }, { status: 422 });
    }
    return NextResponse.json(buildPacket(seed, await matchCandidates(seed), parsed.data));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
