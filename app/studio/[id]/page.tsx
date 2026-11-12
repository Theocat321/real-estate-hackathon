"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EngineResult, Investor, OptionId, Packet, Structure } from "@/contracts";
import { Notice } from "@/components/ui";
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
      <div className="max-w-md">
        <h1 className="wide text-[24px] font-bold">This packet isn't in this browser session</h1>
        <p className="mt-2 text-muted">Packets live in the tab that built them. Pick a property again to rebuild it.</p>
        <Link href="/" className="mt-5 inline-block rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-sheet">
          Pick a property
        </Link>
      </div>
    );
  if (!packet) return <p className="text-muted">Loading packet…</p>;

  const seed = packet.items.find((p) => p.id === packet.seed_id) ?? packet.items[0];
  const upfront = (o: OptionId) => result?.totals[o]?.acquire ?? Infinity;
  const best = result ? OPTIONS.reduce((a, b) => (upfront(b) < upfront(a) ? b : a)) : null;
  const tied = best ? OPTIONS.filter((o) => upfront(o) === upfront(best)) : [];

  return (
    <div className="flex flex-col gap-5 lg:h-[calc(100vh-9.5rem)] lg:min-h-[720px]">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link href={`/packet/${encodeURIComponent(packet.id)}`} className="text-[13px] text-muted hover:text-ink">
            Back to the packet
          </Link>
          <h1 className="wide mt-0.5 text-[24px] font-bold leading-tight tracking-tight">
            {packet.items.length} lots, <span className="tabular">{gbp(packet.totals.price_gbp)}</span>
          </h1>
          <p className="truncate text-[13px] text-muted">Starting from {seed.address}</p>
        </div>
        <fieldset className="ml-auto">
          <legend className="mb-1 text-[12px] text-muted">Who is investing</legend>
          <div className="flex rounded-md border border-rule bg-sheet p-0.5 text-[13px]">
            {(Object.keys(INVESTOR_PRESETS) as InvestorPreset[]).map((k) => (
              <button
                key={k}
                onClick={() => setPreset(k)}
                aria-pressed={preset === k}
                className={`rounded-[4px] px-3 py-1.5 transition-colors ${preset === k ? "bg-ink font-semibold text-sheet" : "text-muted hover:text-ink"}`}
              >
                {INVESTOR_PRESETS[k][0].label}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          onClick={onExport}
          disabled={!result || exporting}
          className="rounded-md border border-ink bg-sheet px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-ink hover:text-sheet disabled:opacity-40"
        >
          {exporting ? "Preparing PDF…" : "Download PDF"}
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`grid min-h-0 gap-4 md:grid-cols-2 md:grid-rows-2 transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          {OPTIONS.map((o) => {
            const s = structures?.find((x) => x.option === o);
            const rows = result?.rows.filter((r) => r.option === o && r.stage !== "death") ?? [];
            const isBest = tied.length === 1 && o === best;
            return (
              <section key={o} className={`flex min-h-[360px] flex-col overflow-hidden rounded-md bg-sheet md:min-h-0 ${isBest ? "edged" : "border border-rule"}`}>
                <header className="flex items-start gap-3 px-4 pb-2 pt-3">
                  <span className={`wide grid size-8 shrink-0 place-items-center rounded-[3px] text-[16px] font-extrabold ${isBest ? "bg-edge text-sheet" : "bg-ink text-sheet"}`}>
                    {o}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold leading-tight">{s?.name ?? "Drawing structure…"}</h2>
                    {isBest && <p className="text-[12px] font-medium text-edge">Lowest cost on purchase</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-muted">On purchase</p>
                    <p className="text-[16px] font-bold">
                      <CostMoney title={`Option ${o}, on purchase`} rows={rows.filter((r) => r.stage === "acquire")} amount={result?.totals[o]?.acquire ?? 0} />
                    </p>
                  </div>
                </header>
                <div className="min-h-0 flex-1 border-y border-rule-soft">{s && result && <StructureChart structure={s} rows={result.rows} />}</div>
                <div className="max-h-28 space-y-2 overflow-y-auto px-4 py-2.5">
                  {s?.rationale && <p className="text-[12px] leading-snug text-ink-soft">{s.rationale}</p>}
                  {result && <FlagList flags={result.flags} option={o} />}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <section className="rounded-md border border-rule bg-sheet p-4">
            <h2 className="text-[14px] font-semibold">What each option costs, and when</h2>
            <div className="mt-3 h-52">{result && <TotalsChart result={result} />}</div>
            <div className="mt-3">{result && <TotalsTable result={result} best={tied.length === 1 ? best : null} />}</div>
            <p className="mt-2 text-[11px] text-faint">*Inheritance tax if the family held the lots personally. Shown for comparison with D.</p>
          </section>
          {result && (
            <section className="rounded-md bg-ink p-4 text-sheet [&_button]:border-sheet/30 [&_button:hover]:bg-sheet/10 [&_button:hover]:text-sheet">
              <h2 className="mb-2 text-[12px] font-medium opacity-70">Option D, family trust</h2>
              <OptionDTimelineDark result={result} />
            </section>
          )}
          <p className="px-1 text-[12px] leading-snug text-muted">Select any £ figure to see its formula, inputs, source rows and the rule it applied.</p>
        </aside>
      </div>
    </div>
  );
}

function OptionDTimelineDark({ result }: { result: EngineResult }) {
  return (
    <div className="[&_.text-muted]:text-sheet/60 [&_.text-faint]:text-sheet/45 [&_.bg-ink]:bg-sheet">
      <OptionDTimeline result={result} />
    </div>
  );
}
