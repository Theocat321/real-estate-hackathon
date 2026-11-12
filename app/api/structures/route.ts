import { z } from "zod";
import { InvestorSchema, type StructuresResponse } from "@/agent/contract";
import type { Packet } from "@/agent/contract";
import { buildStructures } from "@/agent/structures";

export const runtime = "nodejs";
export const maxDuration = 30;

// Loose packet check: we only need item id/address/nation/use/property_type. Full Packet typing lives in the contract.
const RequestSchema = z.object({
  packet: z
    .object({
      items: z
        .array(
          z
            .object({
              id: z.string(),
              address: z.string(),
              nation: z.string(),
              use: z.string(),
              property_type: z.string(),
            })
            .passthrough(),
        )
        .min(1),
    })
    .passthrough(),
  investors: z.array(InvestorSchema).default([]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON (StructuresRequest)" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid StructuresRequest", issues: parsed.error.issues }, { status: 400 });

  const { structures, warnings } = await buildStructures(parsed.data.packet as unknown as Packet, parsed.data.investors);
  if (warnings.length) console.warn("[api/structures]", warnings.join("; "));
  const res: StructuresResponse = { structures };
  return Response.json(res);
}
