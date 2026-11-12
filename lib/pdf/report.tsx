/**
 * Structure Studio export: an A4 structuring report laid out like a UK
 * investment-agency brochure (cover, summary, schedule, structures, appendix).
 * Pure component: rendered by app/api/export/route.tsx.
 */
import { Document, Font, Page, StyleSheet, Svg, Rect, Line, Text, View } from "@react-pdf/renderer";
import type { CostRow, EngineResult, OptionId, Packet, Property, SourceRef, Stage, Structure, StructNode } from "@/contracts";
import { FOOTER, OPTIONS, gbp } from "@/lib/api";

/* ───────────────────────── Palette & type (matches app/globals.css) ───────────────────────── */

const C = {
  ink: "#17262a",
  inkSoft: "#33454a",
  muted: "#5e6f6b",
  faint: "#8d9c97",
  rule: "#cdd5d0",
  ruleSoft: "#e2e7e3",
  paper: "#eef1ec",
  sheet: "#ffffff",
  edge: "#b8202f",
  edgeSoft: "#f6e3e4",
  sage: "#5e8a7c",
  sageSoft: "#e3ece8",
  review: "#8a5a00",
  reviewSoft: "#fbf1dc",
};

// Keep words whole: hyphenated option names ("direct-ly") read badly.
Font.registerHyphenationCallback((word) => [word]);

const SANS = "Helvetica";
const BOLD = "Helvetica";
const SERIF = "Times-Roman";

const M = 44; // page margin

const s = StyleSheet.create({
  page: { paddingTop: 70, paddingBottom: 56, paddingHorizontal: M, fontFamily: SANS, fontSize: 8.5, color: C.ink, lineHeight: 1.35 },
  runHead: { position: "absolute", top: 26, left: M, right: M, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 7, borderBottomWidth: 0.6, borderBottomColor: C.ink },
  runHeadL: { fontFamily: BOLD, fontWeight: "bold", fontSize: 7.5, letterSpacing: 1.4, textTransform: "uppercase" },
  runHeadR: { fontSize: 7.5, color: C.muted },
  runFoot: { position: "absolute", bottom: 24, left: M, right: M, flexDirection: "row", justifyContent: "space-between", fontSize: 6.8, color: C.muted, borderTopWidth: 0.5, borderTopColor: C.rule, paddingTop: 6 },
  eyebrow: { fontFamily: BOLD, fontWeight: "bold", fontSize: 7, letterSpacing: 1.6, textTransform: "uppercase", color: C.edge, marginBottom: 4 },
  h1: { fontFamily: SERIF, fontSize: 26, lineHeight: 1.1, marginBottom: 6 },
  h2: { fontFamily: SERIF, fontSize: 15, marginBottom: 8, marginTop: 4 },
  lede: { fontSize: 9.5, color: C.inkSoft, lineHeight: 1.5, marginBottom: 14, maxWidth: 440 },
  muted: { color: C.muted },
  num: { textAlign: "right" },
  th: { fontFamily: BOLD, fontWeight: "bold", fontSize: 6.8, letterSpacing: 0.6, textTransform: "uppercase", color: C.muted },
});

/* ───────────────────────── Helpers ───────────────────────── */

const STAGE_LABEL: Record<Stage, string> = {
  acquire: "On purchase",
  hold: "Each year",
  exit: "On sale",
  ten_year: "Every 10 years",
  death: "On death*",
};
const STAGE_COLOR: Record<Stage, string> = {
  acquire: C.ink,
  hold: C.sage,
  exit: "#9fb8ae",
  ten_year: C.edge,
  death: C.rule,
};
const TAX_LABEL: Record<CostRow["tax"], string> = {
  SDLT_NONRES: "SDLT (non-residential)",
  SDLT_RES_HIGHER: "SDLT (higher rates)",
  SDLT_RES_COMPANY_17: "SDLT 17% (company)",
  STAMP_DUTY_SHARES: "Stamp duty on shares",
  STAMP_DUTY_UNITS: "Stamp duty on fund units",
  CORP_TAX_RENT: "Tax on rent (a year)",
  ATED: "ATED (annual)",
  IHT_ENTRY: "IHT entry charge",
  IHT_TEN_YEAR: "IHT 10-year charge",
  IHT_DEATH_COMPARATOR: "IHT on death (comparator)",
};
const USE_LABEL: Record<Property["use"], string> = { commercial: "Commercial", residential: "Residential", mixed: "Mixed use" };

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** First one or two address parts: "Flat A, 26 King Edward's Road" / "52 High Beech Road". */
function shortAddr(p: Property): string {
  const parts = p.address.split(",").map((x) => x.trim()).filter(Boolean);
  const unit = /^(flat|apartment|unit|lot|suite|plot|room)\b/i.test(parts[0] ?? "") && parts[1];
  return clip((unit ? `${parts[0]}, ${parts[1]}` : parts[0]) || p.id, 48);
}
/** Town line: the parts after the street, without the postcode. */
function townOf(p: Property): string {
  const parts = p.address.split(",").map((x) => x.trim()).filter(Boolean);
  const rest = parts.slice(1).filter((x) => x !== p.postcode && !/\d/.test(x.slice(0, 2)));
  return clip(rest.slice(0, 2).join(", "), 40);
}

const srcText = (r: SourceRef) =>
  [r.file, r.row != null ? `row ${r.row}` : null, r.page != null ? `p.${r.page}` : null, r.record_id].filter(Boolean).join(" · ");

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)}%`);

function compact(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}m`;
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${n}`;
}

/** Depth of each node from the roots, so the boxes read top-down like the on-screen charts. */
function levels(st: Structure): StructNode[][] {
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
  const out: StructNode[][] = [];
  for (const n of st.nodes) (out[d(n.id)] ??= []).push(n);
  return out.filter(Boolean);
}

/* ───────────────────────── Shared chrome ───────────────────────── */

function Chrome({ title }: { title: string }) {
  return (
    <>
      <View style={s.runHead} fixed>
        <Text style={s.runHeadL}>Structure Studio</Text>
        <Text style={s.runHeadR}>{title}</Text>
      </View>
      <View style={s.runFoot} fixed>
        <Text>{FOOTER}</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </>
  );
}

function Section({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <View wrap={false}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.h1}>{title}</Text>
      {lede ? <Text style={s.lede}>{lede}</Text> : <View style={{ height: 10 }} />}
    </View>
  );
}

function OptionBadge({ o, dark, size = 16 }: { o: OptionId; dark?: boolean; size?: number }) {
  return (
    <View style={{ width: size, height: size, backgroundColor: dark ? C.edge : C.ink, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: C.sheet, fontFamily: BOLD, fontWeight: "bold", fontSize: size * 0.55, lineHeight: 1 }}>{o}</Text>
    </View>
  );
}

/* ───────────────────────── Cover ───────────────────────── */

function Cover({ packet, investor, lows, bestName, result, date }: { packet: Packet; investor: string; lows: OptionId[]; bestName: string; result: EngineResult; date: string }) {
  const uses = [...new Set(packet.items.map((p) => USE_LABEL[p.use]))].join(" & ");
  const towns = [...new Set(packet.items.map(townOf).filter(Boolean))];
  const facts: [string, string][] = [
    ["Lots", String(packet.items.length)],
    ["Dwellings", packet.totals.dwellings ? String(packet.totals.dwellings) : "—"],
    ["Passing rent", packet.totals.rent_pa_gbp ? `${gbp(packet.totals.rent_pa_gbp)} p.a.` : "—"],
    ["Blended yield", pct(packet.totals.blended_yield_pct)],
    ["Average lot", gbp(Math.round(packet.totals.price_gbp / Math.max(1, packet.items.length)))],
  ].filter(([, v]) => v !== "—") as [string, string][];
  return (
    <Page size="A4" style={{ fontFamily: SANS, color: C.ink, backgroundColor: C.sheet }}>
      {/* Dark hero band */}
      <View style={{ backgroundColor: C.ink, height: 360, paddingHorizontal: M, paddingTop: 40, paddingBottom: 36, justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 12, height: 12, borderWidth: 1.6, borderColor: C.edge, marginRight: 8, transform: "rotate(45deg)" }} />
            <Text style={{ color: C.sheet, fontFamily: BOLD, fontWeight: "bold", fontSize: 9, letterSpacing: 2.2, textTransform: "uppercase" }}>Structure Studio</Text>
          </View>
          <Text style={{ color: C.faint, fontSize: 8 }}>{date}</Text>
        </View>

        <View>
          <Text style={{ color: C.edge, fontFamily: BOLD, fontWeight: "bold", fontSize: 8, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
            Acquisition structuring report
          </Text>
          <Text style={{ color: C.sheet, fontFamily: SERIF, fontSize: 40, lineHeight: 1.05 }}>
            {packet.items.length}-lot {uses.toLowerCase()} portfolio
          </Text>
          <Text style={{ color: "#b9c6c1", fontSize: 11, marginTop: 10, lineHeight: 1.4 }}>
            {towns.length ? clip(towns.slice(0, 4).join(" · "), 110) : clip(packet.match_reason, 110)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 26, paddingTop: 16, borderTopWidth: 0.6, borderTopColor: "#3a4d52" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.faint, fontSize: 7, letterSpacing: 1.4, textTransform: "uppercase" }}>Aggregate price</Text>
              <Text style={{ color: C.sheet, fontFamily: BOLD, fontWeight: "bold", fontSize: 24, marginTop: 4 }}>{gbp(packet.totals.price_gbp)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.faint, fontSize: 7, letterSpacing: 1.4, textTransform: "uppercase" }}>Prepared for</Text>
              <Text style={{ color: C.sheet, fontSize: 13, marginTop: 4 }}>{investor}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Key facts */}
      <View style={{ paddingHorizontal: M, paddingTop: 26 }}>
        <View style={{ flexDirection: "row", borderTopWidth: 1.2, borderTopColor: C.ink }}>
          {facts.map(([k, v], i) => (
            <View key={k} style={{ flex: 1, paddingVertical: 12, paddingRight: 10, borderBottomWidth: 0.5, borderBottomColor: C.rule, borderLeftWidth: i ? 0.5 : 0, borderLeftColor: C.rule, paddingLeft: i ? 12 : 0 }}>
              <Text style={s.th}>{k}</Text>
              <Text style={{ fontFamily: SANS, fontSize: 15, marginTop: 4 }}>{v}</Text>
            </View>
          ))}
        </View>

        <Text style={[s.th, { marginTop: 20, marginBottom: 6 }]}>The lots</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {packet.items.slice(0, 10).map((p, i) => (
            <View key={p.id} style={{ width: "50%", flexDirection: "row", paddingVertical: 3.5, paddingRight: i % 2 ? 0 : 14, paddingLeft: i % 2 ? 14 : 0, borderBottomWidth: 0.5, borderBottomColor: C.ruleSoft }}>
              <Text style={{ width: 18, fontFamily: BOLD, fontWeight: "bold", fontSize: 7.5, color: p.id === packet.seed_id ? C.edge : C.muted }}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={{ flex: 1, fontSize: 8 }}>
                {clip(shortAddr(p), 30)}
                <Text style={{ color: C.muted }}>{p.postcode ? `  ${p.postcode}` : ""}</Text>
              </Text>
              <Text style={{ fontSize: 8 }}>{gbp(p.price_gbp?.value)}</Text>
            </View>
          ))}
        </View>
        {packet.items.length > 10 && <Text style={{ fontSize: 7, color: C.muted, marginTop: 3 }}>+{packet.items.length - 10} more in the schedule</Text>}

        {lows.length > 0 && (
          <View style={{ marginTop: 22, flexDirection: "row", alignItems: "center", backgroundColor: C.paper, padding: 14, borderLeftWidth: 3, borderLeftColor: C.edge }}>
            <View style={{ flexDirection: "row", gap: 3 }}>
              {lows.map((o) => (
                <OptionBadge key={o} o={o} dark size={24} />
              ))}
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={s.th}>{lows.length > 1 ? "Joint lowest cost on purchase" : "Lowest cost on purchase"}</Text>
              <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: 11, marginTop: 2 }}>
                {lows.length > 1 ? `Options ${lows.join(", ")}` : `Option ${lows[0]}: ${bestName}`}
              </Text>
            </View>
            <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: 16 }}>{gbp(result.totals[lows[0]]?.acquire)}</Text>
          </View>
        )}
      </View>

      <View style={{ position: "absolute", bottom: 26, left: M, right: M, flexDirection: "row", justifyContent: "space-between", fontSize: 6.8, color: C.muted }}>
        <Text>Ref. {packet.id}</Text>
        <Text>{FOOTER}</Text>
      </View>
    </Page>
  );
}

/* ───────────────────────── Summary ───────────────────────── */

function CostChart({ result, stages }: { result: EngineResult; stages: Stage[] }) {
  const W = 507, H = 150, padL = 44, padB = 18, padT = 6;
  const shown = stages.filter((x) => x !== "death");
  const totals = OPTIONS.map((o) => shown.reduce((a, st) => a + (result.totals[o]?.[st] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => max / x <= 4) ?? p * 10;
    return { step, top: Math.ceil(max / step) * step };
  })();
  const plotH = H - padB - padT;
  const y = (v: number) => padT + plotH - (v / nice.top) * plotH;
  const colW = (W - padL) / OPTIONS.length;
  const barW = Math.min(46, colW * 0.42);
  const ticks: number[] = [];
  for (let v = 0; v <= nice.top + 1; v += nice.step) ticks.push(v);
  return (
    <View>
      <Svg width={W} height={H}>
        {ticks.map((t) => (
          <Line key={t} x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.ink : C.ruleSoft} strokeWidth={t === 0 ? 0.8 : 0.5} />
        ))}
        {OPTIONS.map((o, i) => {
          let acc = 0;
          const x = padL + colW * i + (colW - barW) / 2;
          return shown.map((st) => {
            const v = result.totals[o]?.[st] ?? 0;
            if (!v) return null;
            const y0 = y(acc), y1 = y(acc + v);
            acc += v;
            return <Rect key={`${o}${st}`} x={x} y={y1} width={barW} height={Math.max(0.5, y0 - y1 - 0.6)} fill={STAGE_COLOR[st]} />;
          });
        })}
      </Svg>
      {/* Axis labels as text (react-pdf SVG text is limited) */}
      <View style={{ position: "absolute", left: 0, top: 0, width: padL - 6, height: H }}>
        {ticks.map((t) => (
          <Text key={t} style={{ position: "absolute", right: 0, top: y(t) - 4, fontSize: 6.5, color: C.muted }}>
            {compact(t)}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", marginLeft: padL, marginTop: -padB + 5 }}>
        {OPTIONS.map((o, i) => (
          <View key={o} style={{ width: colW, alignItems: "center" }}>
            <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: 8 }}>
              {o} <Text style={{ fontFamily: SANS, fontWeight: "normal", color: C.muted }}>{compact(totals[i])}</Text>
            </Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 14, marginTop: 8, marginLeft: padL }}>
        {shown.map((st) => (
          <View key={st} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 7, height: 7, backgroundColor: STAGE_COLOR[st], marginRight: 4 }} />
            <Text style={{ fontSize: 7, color: C.muted }}>{STAGE_LABEL[st]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Summary({ packet, structures, result, stages, best, investor }: { packet: Packet; structures: Structure[]; result: EngineResult; stages: Stage[]; best: OptionId | null; investor: string }) {
  const low = Math.min(...OPTIONS.map((o) => result.totals[o]?.acquire ?? Infinity));
  return (
    <Page size="A4" style={s.page}>
      <Chrome title={`${packet.items.length} lots · ${gbp(packet.totals.price_gbp)}`} />
      <Section
        eyebrow="01 · Executive summary"
        title="Four ways to own this portfolio"
        lede={`We priced the same ${packet.items.length} lots (${gbp(packet.totals.price_gbp)}) under four ownership structures for this investor: ${investor}. Costs are UK taxes computed from cited rules; amounts are whole pounds.`}
      />

      {/* Option cards */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
        {OPTIONS.map((o) => {
          const st = structures.find((x) => x.option === o);
          const acq = result.totals[o]?.acquire;
          const isBest = o === best;
          const isLow = acq != null && acq === low;
          return (
            <View key={o} style={{ flex: 1, borderTopWidth: 3, borderTopColor: isBest ? C.edge : C.ink, backgroundColor: isBest ? C.edgeSoft : C.paper, padding: 9, minHeight: 110 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                <OptionBadge o={o} dark={isBest} />
                {isLow && <Text style={{ marginLeft: 6, fontFamily: BOLD, fontWeight: "bold", fontSize: 6.5, color: C.edge, letterSpacing: 0.8, textTransform: "uppercase" }}>{isBest ? "Lowest on purchase" : "Joint lowest"}</Text>}
              </View>
              <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: 8.5, minHeight: 22 }}>{st?.name ?? `Option ${o}`}</Text>
              <Text style={[s.th, { marginTop: 6 }]}>On purchase</Text>
              <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: 14, marginTop: 1 }}>{gbp(acq)}</Text>
              <Text style={{ fontSize: 7, color: isLow ? C.edge : C.muted, marginTop: 2 }}>
                {isLow ? "Lowest" : acq != null ? `+${gbp(acq - low)} vs lowest` : ""}
              </Text>
              <View style={{ flexDirection: "row", marginTop: 6, paddingTop: 5, borderTopWidth: 0.5, borderTopColor: C.rule }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 6.5, color: C.muted }}>Each year</Text>
                  <Text style={{ fontSize: 8 }}>{gbp(result.totals[o]?.hold)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 6.5, color: C.muted }}>On sale</Text>
                  <Text style={{ fontSize: 8 }}>{gbp(result.totals[o]?.exit)}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={s.h2}>Tax cost by option and stage</Text>
      <CostChart result={result} stages={stages} />

      {/* Totals table */}
      <View style={{ marginTop: 18 }} wrap={false}>
        <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: C.ink, paddingBottom: 4 }}>
          <Text style={[s.th, { width: 150 }]}>Option</Text>
          {stages.map((st) => (
            <Text key={st} style={[s.th, s.num, { flex: 1 }]}>
              {STAGE_LABEL[st]}
            </Text>
          ))}
        </View>
        {OPTIONS.map((o) => (
          <View key={o} style={{ flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: C.rule, backgroundColor: o === best ? C.edgeSoft : undefined }}>
            <Text style={{ width: 150, fontFamily: BOLD, fontWeight: "bold" }}>
              {o} <Text style={{ fontFamily: SANS, fontWeight: "normal", color: C.inkSoft }}>{clip(structures.find((x) => x.option === o)?.name ?? "", 30)}</Text>
            </Text>
            {stages.map((st) => (
              <Text key={st} style={[s.num, { flex: 1, color: st === "death" ? C.faint : C.ink }]}>
                {result.totals[o]?.[st] == null ? "—" : gbp(result.totals[o][st])}
              </Text>
            ))}
          </View>
        ))}
        {stages.includes("death") && (
          <Text style={{ fontSize: 6.8, color: C.muted, marginTop: 4 }}>
            *Inheritance tax if the family held the lots personally. Shown for comparison with the trust option only.
          </Text>
        )}
      </View>

    </Page>
  );
}

/* ───────────────────────── Schedule of properties ───────────────────────── */

const COLS = { lot: 26, addr: 0, use: 62, tenure: 52, price: 72, rent: 64, yld: 42 };

function Schedule({ packet }: { packet: Packet }) {
  // Drop columns no lot has data for, so the table isn't a wall of dashes.
  const hasTenure = packet.items.some((p) => p.tenure !== "unknown");
  const hasRent = packet.items.some((p) => p.rent_pa_gbp);
  const hasYield = packet.items.some((p) => p.yield_pct);
  const head = (
    <View style={{ flexDirection: "row", backgroundColor: C.ink, paddingVertical: 6, paddingHorizontal: 6 }} fixed>
      {[
        ["Lot", COLS.lot, false],
        ["Property", 0, false],
        ["Use", COLS.use, false],
        ...(hasTenure ? [["Tenure", COLS.tenure, false]] : []),
        ["Price", COLS.price, true],
        ...(hasRent ? [["Rent p.a.", COLS.rent, true]] : []),
        ...(hasYield ? [["Yield", COLS.yld, true]] : []),
      ].map(([l, w, r]) => (
        <Text key={l as string} style={[s.th, { color: C.sheet }, w ? { width: w as number } : { flex: 1 }, r ? s.num : {}]}>
          {l as string}
        </Text>
      ))}
    </View>
  );
  return (
    <Page size="A4" style={s.page}>
      <Chrome title={`${packet.items.length} lots · ${gbp(packet.totals.price_gbp)}`} />
      <Section eyebrow="02 · Schedule of properties" title="The lots" lede={packet.match_reason} />
      {head}
      {packet.items.map((p, i) => (
        <View key={p.id} style={{ flexDirection: "row", paddingVertical: 7, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.rule, backgroundColor: i % 2 ? C.paper : C.sheet }} wrap={false}>
          <Text style={{ width: COLS.lot, fontFamily: BOLD, fontWeight: "bold", color: p.id === packet.seed_id ? C.edge : C.ink }}>{String(i + 1).padStart(2, "0")}</Text>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontFamily: BOLD, fontWeight: "bold" }}>{shortAddr(p)}</Text>
            <Text style={{ color: C.muted, fontSize: 7.5 }}>
              {[townOf(p), p.postcode].filter(Boolean).join(" · ")}
              {p.id === packet.seed_id ? "  ·  Seed lot" : ""}
            </Text>
          </View>
          <View style={{ width: COLS.use }}>
            <Text>{USE_LABEL[p.use]}</Text>
            {p.property_type.toLowerCase() !== p.use && <Text style={{ color: C.muted, fontSize: 7, textTransform: "capitalize" }}>{clip(p.property_type, 16)}</Text>}
          </View>
          {hasTenure && <Text style={{ width: COLS.tenure, textTransform: "capitalize" }}>{p.tenure === "unknown" ? "—" : p.tenure}</Text>}
          <View style={{ width: COLS.price }}>
            <Text style={[s.num, { fontFamily: BOLD, fontWeight: "bold" }]}>{gbp(p.price_gbp?.value)}</Text>
            {p.price_kind && <Text style={[s.num, { color: C.muted, fontSize: 6.8, textTransform: "capitalize" }]}>{p.price_kind}</Text>}
          </View>
          {hasRent && <Text style={[s.num, { width: COLS.rent }]}>{gbp(p.rent_pa_gbp?.value)}</Text>}
          {hasYield && <Text style={[s.num, { width: COLS.yld }]}>{pct(p.yield_pct?.value)}</Text>}
        </View>
      ))}
      <View style={{ flexDirection: "row", paddingVertical: 8, paddingHorizontal: 6, borderTopWidth: 1.2, borderTopColor: C.ink }} wrap={false}>
        <Text style={{ width: COLS.lot }} />
        <Text style={{ flex: 1, fontFamily: BOLD, fontWeight: "bold" }}>
          Total · {packet.items.length} lots{packet.totals.dwellings ? ` · ${packet.totals.dwellings} dwellings` : ""}
        </Text>
        <Text style={{ width: COLS.use + (hasTenure ? COLS.tenure : 0) }} />
        <Text style={[s.num, { width: COLS.price, fontFamily: BOLD, fontWeight: "bold" }]}>{gbp(packet.totals.price_gbp)}</Text>
        {hasRent && <Text style={[s.num, { width: COLS.rent, fontFamily: BOLD, fontWeight: "bold" }]}>{packet.totals.rent_pa_gbp ? gbp(packet.totals.rent_pa_gbp) : "—"}</Text>}
        {hasYield && <Text style={[s.num, { width: COLS.yld, fontFamily: BOLD, fontWeight: "bold" }]}>{pct(packet.totals.blended_yield_pct)}</Text>}
      </View>
      <Text style={{ fontSize: 7, color: C.muted, marginTop: 6 }}>
        Prices are asking, guide or achieved as marked; every figure traces to a source in the appendix.
      </Text>
    </Page>
  );
}

/* ───────────────────────── Structure pages ───────────────────────── */

const NODE_STYLE: Record<StructNode["kind"], { bg: string; fg: string; border: string }> = {
  investor: { bg: C.sheet, fg: C.ink, border: C.ink },
  trust: { bg: C.ink, fg: C.sheet, border: C.ink },
  fund: { bg: C.sageSoft, fg: C.ink, border: C.sage },
  company: { bg: C.paper, fg: C.ink, border: C.inkSoft },
  property: { bg: C.sheet, fg: C.ink, border: C.edge },
};

const TAX_SHORT: Record<CostRow["tax"], string> = {
  SDLT_NONRES: "SDLT",
  SDLT_RES_HIGHER: "SDLT",
  SDLT_RES_COMPANY_17: "SDLT 17%",
  STAMP_DUTY_SHARES: "Stamp duty",
  STAMP_DUTY_UNITS: "Stamp duty on units",
  CORP_TAX_RENT: "Tax on rent p.a.",
  ATED: "ATED p.a.",
  IHT_ENTRY: "IHT entry",
  IHT_TEN_YEAR: "IHT 10-yr",
  IHT_DEATH_COMPARATOR: "IHT death*",
};

function NodeBox({ n, rows, packet, compactMode }: { n: StructNode; rows: CostRow[]; packet: Packet; compactMode: boolean }) {
  const st = NODE_STYLE[n.kind];
  const prop = n.property_id ? packet.items.find((p) => p.id === n.property_id) : undefined;
  const label = prop ? shortAddr(prop) : n.label;
  const costs = rows.filter((r) => r.entity_id === n.id && r.stage !== "death");
  return (
    <View style={{ backgroundColor: st.bg, borderWidth: n.kind === "property" ? 1.2 : 0.8, borderColor: st.border, paddingVertical: 5, paddingHorizontal: 6, width: "100%" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: compactMode ? 7 : 8, color: st.fg, flex: 1 }}>{clip(label, compactMode ? 34 : 44)}</Text>
        {n.jurisdiction && !compactMode && <Text style={{ fontSize: 6.5, color: n.kind === "trust" ? C.faint : C.muted, marginLeft: 4 }}>{n.jurisdiction}</Text>}
      </View>
      {costs.map((r, i) => (
        <Text key={i} style={{ fontSize: compactMode ? 6.3 : 7, color: n.kind === "trust" ? "#c9d3cf" : C.inkSoft, marginTop: 1 }}>
          {TAX_SHORT[r.tax]} <Text style={{ fontFamily: BOLD, fontWeight: "bold" }}>{gbp(r.amount_gbp)}</Text>
        </Text>
      ))}
    </View>
  );
}

/** Org chart: single-node levels stack centred; the widest level fans out with a connector bar. */
function Tree({ st, rows, packet }: { st: Structure; rows: CostRow[]; packet: Packet }) {
  const lv = levels(st);
  const LINE = C.faint;
  return (
    <View style={{ alignItems: "center", paddingVertical: 6 }}>
      {lv.map((lvl, i) => {
        const many = lvl.length > 1;
        const compactMode = lvl.length > 4;
        return (
          <View key={i} style={{ width: "100%", alignItems: "center" }}>
            {i > 0 && !many && <View style={{ width: 0.8, height: 12, backgroundColor: LINE }} />}
            {i > 0 && many && <View style={{ width: 0.8, height: 8, backgroundColor: LINE }} />}
            {many ? (
              <View style={{ width: "100%" }}>
                {i > 0 && (
                  <View style={{ position: "relative", height: 8 }}>
                    <View style={{ position: "absolute", top: 0, height: 0.8, backgroundColor: LINE, left: `${50 / lvl.length}%`, right: `${50 / lvl.length}%` }} />
                  </View>
                )}
                <View style={{ flexDirection: "row", width: "100%" }}>
                  {lvl.map((n) => (
                    <View key={n.id} style={{ flex: 1, alignItems: "center", paddingHorizontal: 2 }}>
                      {i > 0 && <View style={{ width: 0.8, height: 8, marginTop: -8, backgroundColor: LINE }} />}
                      <NodeBox n={n} rows={rows} packet={packet} compactMode={compactMode} />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={{ width: 190 }}>
                <NodeBox n={lvl[0]} rows={rows} packet={packet} compactMode={false} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function StructureBlock({ st, result, packet, best, index }: { st: Structure; result: EngineResult; packet: Packet; best: OptionId | null; index: number }) {
  const rows = result.rows.filter((r) => r.option === st.option);
  const flags = result.flags.filter((f) => f.option === st.option);
  const t = result.totals[st.option] ?? {};
  // Group cost rows by stage + tax so 5 identical SDLT lines read as one line.
  const grouped = new Map<string, { stage: Stage; tax: CostRow["tax"]; n: number; amount: number }>();
  for (const r of rows) {
    const k = `${r.stage}|${r.tax}`;
    const g = grouped.get(k) ?? { stage: r.stage, tax: r.tax, n: 0, amount: 0 };
    g.n += 1;
    g.amount += r.amount_gbp;
    grouped.set(k, g);
  }
  return (
    <View break={index > 0} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
        <OptionBadge o={st.option} dark={st.option === best} size={22} />
        <Text style={[s.eyebrow, { marginBottom: 0, marginLeft: 8, color: st.option === best ? C.edge : C.muted }]}>
          03 · Structure {st.option}
          {st.option === best ? " · lowest on purchase" : ""}
        </Text>
      </View>
      <Text style={s.h1}>{st.name}</Text>
      <Text style={s.lede}>{st.rationale}</Text>

      {/* KPI strip */}
      <View style={{ flexDirection: "row", borderTopWidth: 1.2, borderTopColor: C.ink, borderBottomWidth: 0.5, borderBottomColor: C.rule, marginBottom: 12 }}>
        {(["acquire", "hold", "exit", "ten_year"] as Stage[]).map((sg, i) => (
          <View key={sg} style={{ flex: 1, paddingVertical: 8, paddingLeft: i ? 10 : 0, borderLeftWidth: i ? 0.5 : 0, borderLeftColor: C.rule }}>
            <Text style={s.th}>{STAGE_LABEL[sg]}</Text>
            <Text style={{ fontFamily: BOLD, fontWeight: "bold", fontSize: 13, marginTop: 3, color: t[sg] == null ? C.faint : C.ink }}>{gbp(t[sg])}</Text>
          </View>
        ))}
      </View>

      {/* Diagram */}
      <View style={{ backgroundColor: C.paper, padding: 12, marginBottom: 12 }} wrap={false}>
        <Text style={[s.th, { marginBottom: 4 }]}>Ownership chart</Text>
        <Tree st={st} rows={rows} packet={packet} />
      </View>

      <View style={{ flexDirection: "row", gap: 16 }}>
      {/* Cost breakdown */}
      <View style={{ flex: 1.15 }} wrap={false}>
        <View style={{ flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: C.ink, paddingBottom: 4 }}>
          <Text style={[s.th, { width: 70 }]}>When</Text>
          <Text style={[s.th, { flex: 1 }]}>Tax</Text>
          <Text style={[s.th, { width: 28 }, s.num]}>No.</Text>
          <Text style={[s.th, { width: 64 }, s.num]}>Amount</Text>
        </View>
        {[...grouped.values()].map((g, i) => (
          <View key={i} style={{ flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.ruleSoft }}>
            <Text style={{ width: 70, color: C.muted }}>{STAGE_LABEL[g.stage]}</Text>
            <Text style={{ flex: 1, color: g.stage === "death" ? C.faint : C.ink }}>{TAX_LABEL[g.tax]}</Text>
            <Text style={[s.num, { width: 28, color: C.muted }]}>{g.n}</Text>
            <Text style={[s.num, { width: 64, fontFamily: BOLD, fontWeight: "bold", color: g.stage === "death" ? C.faint : C.ink }]}>{gbp(g.amount)}</Text>
          </View>
        ))}
        {grouped.size === 0 && <Text style={[s.muted, { paddingVertical: 4 }]}>No taxes computed for this option.</Text>}
      </View>

      {flags.length > 0 && (
        <View style={{ flex: 1 }}>
          <View style={{ borderBottomWidth: 0.8, borderBottomColor: C.ink, paddingBottom: 4, marginBottom: 4 }}>
            <Text style={s.th}>Points to note</Text>
          </View>
          {flags.map((f, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 3, paddingVertical: 4, paddingHorizontal: 5, backgroundColor: f.severity === "review" ? C.reviewSoft : C.sageSoft }} wrap={false}>
              <Text style={{ width: 36, fontFamily: BOLD, fontWeight: "bold", fontSize: 6, color: f.severity === "review" ? C.review : C.sage, textTransform: "uppercase" }}>
                {f.severity === "review" ? "Review" : "Note"}
              </Text>
              <Text style={{ flex: 1, color: C.inkSoft, fontSize: 7.2, lineHeight: 1.3 }}>{f.message}</Text>
            </View>
          ))}
        </View>
      )}
      </View>
    </View>
  );
}

/* ───────────────────────── Appendix ───────────────────────── */

function Appendix({ packet, result }: { packet: Packet; result: EngineResult }) {
  const sources = new Map<string, SourceRef>();
  for (const p of packet.items) for (const v of [p.price_gbp, p.rent_pa_gbp, p.yield_pct]) if (v) sources.set(srcText(v.source), v.source);
  const rules = new Map(result.rows.map((r) => [r.rule.id, r.rule]));
  return (
    <Page size="A4" style={s.page}>
      <Chrome title="Appendix" />
      <Section eyebrow="04 · Appendix" title="Sources and rules" lede="Every property figure and every tax amount in this report traces to one of the references below." />
      <Text style={s.h2}>Tax rules applied</Text>
      {[...rules.values()].map((r) => (
        <View key={r.id} style={{ flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.ruleSoft }} wrap={false}>
          <Text style={{ width: 150, fontFamily: BOLD, fontWeight: "bold" }}>{r.id}</Text>
          <Text style={{ width: 50, color: C.muted }}>{r.as_of}</Text>
          <Text style={{ flex: 1, color: C.sage, fontSize: 7.5 }}>{r.citation_url}</Text>
        </View>
      ))}
      <Text style={[s.h2, { marginTop: 16 }]}>Property data</Text>
      {[...sources.values()].map((src, i) => (
        <View key={i} style={{ flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: C.ruleSoft }} wrap={false}>
          <Text style={{ width: 60, color: C.muted, textTransform: "capitalize" }}>{src.kind}</Text>
          <Text style={{ width: 200 }}>{srcText(src)}</Text>
          <Text style={{ flex: 1, color: C.sage, fontSize: 7 }}>{src.url ? clip(src.url, 80) : ""}</Text>
        </View>
      ))}
      <View style={{ marginTop: 24, padding: 12, backgroundColor: C.paper }} wrap={false}>
        <Text style={[s.th, { marginBottom: 4 }]}>Important notice</Text>
        <Text style={{ color: C.inkSoft, fontSize: 7.5, lineHeight: 1.5 }}>
          This report is decision support, not tax advice. Property data is sourced from the listed files; ownership structures are
          simulated; tax amounts are computed from the cited rules as of the stated tax year. Confirm any structure with a qualified
          adviser before acting.
        </Text>
      </View>
    </Page>
  );
}

/* ───────────────────────── Document ───────────────────────── */

export function ReportPdf({ packet, structures, result, date = new Date() }: { packet: Packet; structures: Structure[]; result: EngineResult; date?: Date }) {
  const stages = (["acquire", "hold", "exit", "ten_year", "death"] as Stage[]).filter((st) => OPTIONS.some((o) => result.totals[o]?.[st] != null));
  const acq = (o: OptionId) => result.totals[o]?.acquire ?? Infinity;
  const min = Math.min(...OPTIONS.map(acq));
  const lows = OPTIONS.filter((o) => acq(o) === min);
  const best = lows.length === 1 && Number.isFinite(min) ? lows[0] : null;
  const investorNode = structures.flatMap((x) => x.nodes).find((n) => n.kind === "investor");
  const investor = investorNode?.label ?? "Unspecified";
  const dateStr = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <Document title={`Structure Studio — ${packet.items.length} lots, ${gbp(packet.totals.price_gbp)}`} author="Structure Studio" subject="Acquisition structuring report">
      <Cover packet={packet} investor={investor} lows={Number.isFinite(min) ? lows : []} bestName={structures.find((x) => x.option === best)?.name ?? ""} result={result} date={dateStr} />
      <Summary packet={packet} structures={structures} result={result} stages={stages} best={best} investor={investor} />
      <Schedule packet={packet} />
      <Page size="A4" style={s.page}>
        <Chrome title="Ownership structures" />
        {structures.map((st, i) => (
          <StructureBlock key={st.option} st={st} result={result} packet={packet} best={best} index={i} />
        ))}
      </Page>
      <Appendix packet={packet} result={result} />
    </Document>
  );
}
