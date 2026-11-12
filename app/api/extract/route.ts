import { extractUpload } from "@/agent/extract";
import { GrokCacheMiss } from "@/agent/grok";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data with a "file" field' }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: 'Missing "file" field' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File too large (max 20 MB)" }, { status: 413 });

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    return Response.json(await extractUpload(file.name || "upload", data, file.type));
  } catch (e) {
    const status = e instanceof GrokCacheMiss ? 503 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
