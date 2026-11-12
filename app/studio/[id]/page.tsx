"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EngineResult, Investor, Packet, Structure } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";
import { StructureChart } from "@/components/StructureChart";
import { FlagList, OptionDTimeline, TotalsChart, TotalsTable } from "@/components/StudioPanels";
import {
  INVESTOR_PRESETS,
  OPTIONS,
  buildStructures,
  exportPdf,
  gbp,
  loadPacket,
  runScenario,
  type InvestorPreset,
} from "@/lib/api";

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [preset, setPreset] = useState<InvestorPreset>("uk_pension");
  const [structures, setStructures] = useState<Structure[] | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const p = loadPacket(decodeURIComponent(id));
    if (p) setPacket(p);
    else setError("Packet not found in this session.");
  }, [id]);

  const run = useCallback(async (p: Packet, investors: Investor[]) => {
    setLoading(true);
    setError(null);
    try {
      const { structures } = await buildStructures(p, investors);
      setStructures(structures);
      setResult(await runScenario({ packet: p, structures, investors }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (packet) void run(packet, INVESTOR_PRESETS[preset]);
  }, [packet, preset, run]);

  async function onExport() {
    if (!packet || !structures || !result) return;
    setExporting(true);
    try {
      const blob = await exportPdf({ packet, structures, result });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `structure-studio-${packet.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  if (error && !packet)
    return (
      <p className="text-slate-600">
        {error} <Link href="/" className="text-accent underline">Start again</Link>.
      </p>
    );
  if (!packet) return <p className="text-slate-500">Loading…</p>;

  const seed = packet.items.find((p) => p.id === packet.seed_id) ?? packet.items[0];

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[700px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/packet/${encodeURIComponent(packet.id)}`} className="text-sm text-slate-500 hover:text-accent">
          ← Packet
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          {packet.items.length} lots · {gbp(packet.totals.price_gbp)}
          <span className="ml-2 text-sm font-normal text-slate-500">seed: {seed.address}</span>
        </h1>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-sm">
          {(Object.keys(INVESTOR_PRESETS) as InvestorPreset[]).map((k) => (
            <button
              key={k}
              onClick={() => setPreset(k)}
              className={`rounded-md px-3 py-1 ${preset === k ? "bg-white font-medium shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {INVESTOR_PRESETS[k][0].label}
            </button>
          ))}
        </div>
        <button
          onClick={onExport}
          disabled={!result || exporting}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] gap-3">
        <div className={`grid min-h-0 grid-cols-2 grid-rows-2 gap-3 ${loading ? "opacity-60" : ""}`}>
          {OPTIONS.map((o) => {
            const s = structures?.find((x) => x.option === o);
            const rows = result?.rows.filter((r) => r.option === o && r.stage !== "death") ?? [];
            return (
              <section key={o} className="flex min-h-0 flex-col rounded-xl border border-slate-200">
                <header className="flex items-baseline gap-2 border-b border-slate-100 px-3 py-1.5">
                  <span className="rounded bg-accent px-1.5 text-xs font-semibold text-white">{o}</span>
                  <span className="truncate text-sm font-medium">{s?.name ?? "…"}</span>
                  <span className="ml-auto text-xs text-slate-500">
                    upfront{" "}
                    <CostMoney
                      title={`Option ${o} · acquire`}
                      rows={rows.filter((r) => r.stage === "acquire")}
                      amount={result?.totals[o]?.acquire ?? 0}
                      className="font-semibold text-slate-900"
                    />
                  </span>
                </header>
                <div className="min-h-0 flex-1">{s && result && <StructureChart structure={s} rows={result.rows} />}</div>
                <div className="max-h-24 overflow-y-auto border-t border-slate-100 px-3 py-1.5">
                  {s?.rationale && <p className="mb-1 text-[11px] text-slate-600">{s.rationale}</p>}
                  {result && <FlagList flags={result.flags} option={o} />}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <section className="rounded-xl border border-slate-200 p-3">
            <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Cost by option and stage</h2>
            <div className="h-48">{result && <TotalsChart result={result} />}</div>
            <div className="mt-2">{result && <TotalsTable result={result} />}</div>
          </section>
          {result && (
            <section className="rounded-xl border border-purple-200 bg-purple-50/40 p-3">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-purple-700">Option D · family trust</h2>
              <OptionDTimeline result={result} />
            </section>
          )}
          <p className="px-1 text-[11px] text-slate-400">Click any £ figure to see its formula, inputs, source rows and rule citation.</p>
        </aside>
      </div>
    </div>
  );
}
