import { runEngine, ScenarioInputSchema } from "@/engine";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ScenarioInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_scenario", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return Response.json(runEngine(parsed.data));
  } catch (e) {
    return Response.json({ error: "engine_error", message: (e as Error).message }, { status: 422 });
  }
}
