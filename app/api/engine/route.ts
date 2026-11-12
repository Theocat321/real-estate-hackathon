import type { EngineResponse } from "@/contracts";
import { runEngine, ScenarioInputSchema } from "@/engine";

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
  try {
    const result: EngineResponse = runEngine(parsed.data);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Engine failed" }, { status: 422 });
  }
}
