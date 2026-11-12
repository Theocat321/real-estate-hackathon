import { renderToBuffer } from "@react-pdf/renderer";
import type { ExportRequest } from "@/contracts";
import { ReportPdf } from "@/lib/pdf/report";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: ExportRequest;
  try {
    body = (await req.json()) as ExportRequest;
  } catch {
    return Response.json({ error: "Body must be JSON (ExportRequest)" }, { status: 400 });
  }
  if (!body?.packet?.items || !Array.isArray(body.structures) || !body.result?.rows) {
    return Response.json({ error: "ExportRequest needs packet, structures and result" }, { status: 400 });
  }
  try {
    const buf = await renderToBuffer(<ReportPdf packet={body.packet} structures={body.structures} result={body.result} />);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="structure-studio-${body.packet.id}.pdf"`,
      },
    });
  } catch (e) {
    return Response.json({ error: `PDF render failed: ${(e as Error).message}` }, { status: 500 });
  }
}
