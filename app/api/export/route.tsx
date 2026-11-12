import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CostRow, EngineResult, ExportRequest, Packet, SourceRef, Structure } from "@/contracts";
import { FOOTER, OPTIONS, STAGES, gbp } from "@/lib/api";

export const runtime = "nodejs";

const s = StyleSheet.create({
  page: { padding: 24, paddingBottom: 36, fontSize: 7.5, fontFamily: "Helvetica", color: "#0f172a" },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  h2: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b", marginTop: 8, marginBottom: 3, textTransform: "uppercase" },
  muted: { color: "#64748b" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 1.5 },
  cell: { flex: 1 },
  num: { width: 62, textAlign: "right" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  box: { width: "49%", borderWidth: 0.5, borderColor: "#cbd5e1", borderRadius: 3, padding: 5 },
  node: { borderWidth: 0.5, borderRadius: 2, paddingHorizontal: 3, paddingVertical: 1.5, marginBottom: 2 },
  footer: { position: "absolute", bottom: 14, left: 24, right: 24, textAlign: "center", color: "#64748b", fontSize: 7 },
});

const NODE_COLOR: Record<string, string> = {
  investor: "#94a3b8",
  trust: "#a855f7",
  fund: "#14b8a6",
  company: "#3b82f6",
  property: "#f59e0b",
};

const srcText = (r: SourceRef) =>
  [r.file, r.row != null ? `row ${r.row}` : null, r.page != null ? `p.${r.page}` : null, r.record_id].filter(Boolean).join(" · ");

/** Depth of each node from the roots, so the boxes read top-down like the charts. */
function levels(st: Structure): Structure["nodes"][] {
  const parents = new Map<string, string[]>();
  for (const e of st.edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const depth = new Map<string, number>();
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ps = parents.get(id) ?? [];
    const v = ps.length ? Math.max(...ps.map((p) => d(p, seen))) + 1 : 0;
    depth.set(id, v);
    return v;
  };
  const out: Structure["nodes"][] = [];
  for (const n of st.nodes) (out[d(n.id)] ??= []).push(n);
  return out.filter(Boolean);
}

function StructureBox({ st, rows }: { st: Structure; rows: CostRow[] }) {
  return (
    <View style={s.box} wrap={false}>
      <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3 }}>
        {st.option} · {st.name}
      </Text>
      {levels(st).map((lvl, i) => (
        <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>
          {lvl.map((n) => {
            const cost = rows.filter((r) => r.entity_id === n.id && r.stage !== "death");
            return (
              <View key={n.id} style={[s.node, { borderColor: NODE_COLOR[n.kind] ?? "#94a3b8" }]}>
                <Text>
                  {n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label}
                  {n.jurisdiction ? ` [${n.jurisdiction}]` : ""}
                </Text>
                {cost.length > 0 && (
                  <Text style={s.muted}>{cost.map((r) => `${r.tax} ${gbp(r.amount_gbp)}`).join(" · ")}</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Pdf({ packet, structures, result }: { packet: Packet; structures: Structure[]; result: EngineResult }) {
  const stages = STAGES.filter((st) => OPTIONS.some((o) => result.totals[o]?.[st] != null));
  const sources = new Map<string, SourceRef>();
  for (const p of packet.items) {
    for (const v of [p.price_gbp, p.rent_pa_gbp, p.yield_pct]) if (v) sources.set(srcText(v.source), v.source);
  }
  const rules = new Map(result.rows.map((r) => [r.rule.id, r.rule]));
  return (
    <Document title={`Structure Studio — ${packet.id}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Structure Studio · packet {packet.id}</Text>
        <Text style={s.muted}>{packet.match_reason}</Text>

        <Text style={s.h2}>Packet</Text>
        {packet.items.map((p) => (
          <View key={p.id} style={s.row}>
            <Text style={s.cell}>
              {p.address}
              {p.id === packet.seed_id ? " (seed)" : ""}
            </Text>
            <Text style={{ width: 60 }}>{p.use}</Text>
            <Text style={s.num}>{gbp(p.price_gbp?.value)}</Text>
            <Text style={s.num}>{p.yield_pct ? `${p.yield_pct.value.toFixed(2)}%` : "—"}</Text>
          </View>
        ))}
        <View style={[s.row, { borderBottomWidth: 0 }]}>
          <Text style={[s.cell, { fontFamily: "Helvetica-Bold" }]}>
            Total · {packet.totals.dwellings} dwellings · rent {gbp(packet.totals.rent_pa_gbp)} p.a.
          </Text>
          <Text style={{ width: 60 }} />
          <Text style={[s.num, { fontFamily: "Helvetica-Bold" }]}>{gbp(packet.totals.price_gbp)}</Text>
          <Text style={s.num}>{packet.totals.blended_yield_pct == null ? "—" : `${packet.totals.blended_yield_pct.toFixed(2)}%`}</Text>
        </View>

        <Text style={s.h2}>Structures</Text>
        <View style={s.grid}>
          {structures.map((st) => (
            <StructureBox key={st.option} st={st} rows={result.rows.filter((r) => r.option === st.option)} />
          ))}
        </View>

        <Text style={s.h2}>Totals by option and stage (£)</Text>
        <View style={s.row}>
          <Text style={{ width: 40 }} />
          {stages.map((st) => (
            <Text key={st} style={[s.cell, { textAlign: "right", color: "#64748b" }]}>
              {st === "death" ? "death (comparator)" : st.replace("_", " ")}
            </Text>
          ))}
        </View>
        {OPTIONS.map((o) => (
          <View key={o} style={s.row}>
            <Text style={{ width: 40, fontFamily: "Helvetica-Bold" }}>{o}</Text>
            {stages.map((st) => (
              <Text key={st} style={[s.cell, { textAlign: "right" }]}>
                {result.totals[o]?.[st] == null ? "—" : gbp(result.totals[o][st])}
              </Text>
            ))}
          </View>
        ))}

        <Text style={s.h2}>Flags</Text>
        {result.flags.map((f, i) => (
          <Text key={i} style={{ marginBottom: 1 }}>
            [{f.option}] {f.severity.toUpperCase()}: {f.message}
          </Text>
        ))}

        <Text style={s.h2}>Sources and rules</Text>
        {[...sources.values()].map((src, i) => (
          <Text key={i} style={s.muted}>
            {src.kind}: {srcText(src)}
            {src.url ? ` · ${src.url}` : ""}
          </Text>
        ))}
        {[...rules.values()].map((r) => (
          <Text key={r.id} style={s.muted}>
            rule {r.id} (as of {r.as_of}): {r.citation_url}
          </Text>
        ))}

        <Text style={s.footer} fixed>
          {FOOTER}
        </Text>
      </Page>
    </Document>
  );
}

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
    const buf = await renderToBuffer(<Pdf packet={body.packet} structures={body.structures} result={body.result} />);
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
