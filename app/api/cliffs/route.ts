import { ScenarioInputSchema } from "@/engine";
import { findCliffs } from "@/engine/cliffs";
import { matchCandidates } from "@/lib/db";

export const runtime = "nodejs";

/** POST /api/cliffs  body: ScenarioInput → { cliffs: Cliff[] } */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }
  const parsed = ScenarioInputSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: `Invalid ScenarioInput at ${issue.path.join(".") || "(root)"}: ${issue.message}` }, { status: 400 });
  }
  const input = parsed.data;
  try {
    const seed = input.packet.items.find((p) => p.id === input.packet.seed_id) ?? input.packet.items[0];
    const candidates = seed ? await matchCandidates(seed).catch(() => []) : [];
    return Response.json({ cliffs: findCliffs(input, candidates) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Cliff search failed" }, { status: 422 });
  }
}
