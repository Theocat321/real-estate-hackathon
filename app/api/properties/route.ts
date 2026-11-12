import { NextResponse } from "next/server";
import { z } from "zod";
import { listProperties } from "@/lib/db";

const Query = z.object({
  use: z.enum(["residential", "commercial", "mixed"]).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  for (const k of Object.keys(sp)) if (sp[k] === "") delete sp[k];
  const parsed = Query.safeParse(sp);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await listProperties(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
