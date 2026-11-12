"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineResult, Investor, OptionId, Packet, Structure } from "@/contracts";
import { Notice } from "@/components/ui";
import { CliffPanel } from "@/components/CliffPanel";
import type { Cliff } from "@/engine/cliffs";
import type { OptimiseResult } from "@/engine/optimise";
import { CostMoney } from "@/components/SourceDrawer";
import { StructureChart } from "@/components/StructureChart";
import { FlagList, OptionDTimeline, SaleChart, SaleTable, TotalsChart, TotalsTable, saleNote } from "@/components/StudioPanels";
import { DEFAULT_ASSUMPTIONS, HORIZONS, HORIZON_LABEL, breakdown, isFamily, paysAted, saleSaving, type Assumptions, type Horizon } from "@/lib/horizon";
import {
  INVESTOR_PRESETS,
  OPTIONS,
  buildStructures,
  findCliffs,
  exportPdf,
  gbp,
  loadPacket,
  loadPlan,
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
  const [cliffs, setCliffs] = useState<Cliff[] | null>(null);
  const [tab, setTab] = useState<OptionId>("A");
  // Open on the best option each time the result or the period changes; the user can still click another.
  const [pickedFor, setPickedFor] = useState<{ result: EngineResult; horizon: Horizon } | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("25y_sell");
  const [assume, setAssume] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [panelOpen, setPanelOpen] = useState(true);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const prev = useRef<{ preset: InvestorPreset; structures: Structure[]; result: EngineResult } | null>(null);

  const [plan, setPlan] = useState<OptimiseResult | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("investor");
    if (q && q in INVESTOR_PRESETS) setPreset(q as InvestorPreset);
    const p = loadPacket(decodeURIComponent(id));
    const pl = loadPlan(decodeURIComponent(id));
    setPlan(pl);
    if (pl) setTab(pl.best.groups[0].option);
    if (p) setPacket(p);
    else setError("Packet not found in this session.");
  }, [id]);

  const run = useCallback(async (p: Packet, investors: Investor[]) => {
    setLoading(true);
    setError(null);
    try {
      const { structures } = await buildStructures(p, investors);
      const scenario = { packet: p, structures, investors };
      const result = await runScenario(scenario);
      setCliffs(null);
      findCliffs(scenario).then(setCliffs).catch(() => setCliffs([]));
      setStructures(structures);
      setResult(result);
      setChangeNote(prev.current && prev.current.preset !== presetRef.current ? describeChange(prev.current, { structures, result }, investors[0]?.label ?? "these investors") : null);
      prev.current = { preset: presetRef.current, structures, result };
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const presetRef = useRef(preset);
  useEffect(() => {
    presetRef.current = preset;
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
  const family = isFamily(INVESTOR_PRESETS[preset]);
  const onSale = horizon === "sale";
  const totalOf = (o: OptionId) => (result ? breakdown(result, o, horizon, family, assume).total : Infinity);
  const showRelief = !!result && paysAted(result) && horizon !== "purchase" && !onSale;
  const showShare = horizon === "25y_sell";
  const savingOf = (o: OptionId) => (result ? saleSaving(result, o).saving : 0);
  // On sale, higher is better (a saving); otherwise lower is better (a cost). `score` is lower-is-better either way.
  const score = (o: OptionId) => (onSale ? -savingOf(o) : totalOf(o));
  // Option D is a family trust: only shown when a family is investing.
  const shown = family ? OPTIONS : OPTIONS.filter((o) => o !== "D");
  const best = result ? shown.reduce((a, b) => (score(b) < score(a) ? b : a)) : null;
  const tied = best ? shown.filter((o) => score(o) === score(best)) : [];
  const soleBest = tied.length === 1 && !(onSale && best && savingOf(best) === 0) ? best : null;
  if (result && best && (pickedFor?.result !== result || pickedFor.horizon !== horizon)) {
    setPickedFor({ result, horizon });
    if (best !== tab) setTab(best);
  }
  const shownCliffs = cliffs && !family ? cliffs.filter((c) => c.best.option !== "D") : cliffs;
  const s = structures?.find((x) => x.option === tab);
  const rows = result?.rows.filter((r) => r.option === tab) ?? [];

  function onTabKey(e: React.KeyboardEvent) {
    const i = shown.indexOf(tab);
    const n = shown.length;
    const next = e.key === "ArrowRight" ? shown[(i + 1) % n] : e.key === "ArrowLeft" ? shown[(i + n - 1) % n] : null;
    if (next) {
      e.preventDefault();
      setTab(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  }

  return (
    <div className={`relative -mx-6 -my-8 px-6 py-4 transition-[padding] ${panelOpen ? "lg:pr-[376px] xl:pr-[412px]" : ""}`}>
      {/* Header row */}
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
          <legend className="mb-1 text-[12px] text-muted">Compare over</legend>
          <div className="flex rounded-md border border-rule bg-sheet p-0.5 text-[13px]">
            {HORIZONS.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                aria-pressed={horizon === h}
                className={`rounded-[4px] px-3 py-1.5 transition-colors ${horizon === h ? "bg-ink font-semibold text-sheet" : "text-muted hover:text-ink"}`}
              >
                {HORIZON_LABEL[h]}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="mb-1 text-[12px] text-muted">Who is investing</p>
          <p className="rounded-md border border-rule bg-sheet px-3 py-[7px] text-[13px] font-semibold">{INVESTOR_PRESETS[preset][0].label}</p>
        </div>
        {!panelOpen && (
          <button
            onClick={onExport}
            disabled={!result || exporting}
            className="rounded-md border border-ink bg-sheet px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-ink hover:text-sheet disabled:opacity-40"
          >
            {exporting ? "Preparing PDF…" : "Download PDF"}
          </button>
        )}
      </div>
      {(showRelief || showShare) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {showRelief && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={assume.atedRelief}
                onChange={(e) => setAssume({ ...assume, atedRelief: e.target.checked })}
                className="size-4 accent-[#17262a]"
              />
              <span>
                Properties are let out <span className="text-muted">(ATED relief: no yearly ATED, a return is still filed)</span>
              </span>
            </label>
          )}
          {showShare && (
            <div className="flex items-center gap-2">
              <span className="text-muted">Of the buyer&apos;s stamp duty saving, you get back</span>
              <div className="flex rounded-md border border-rule bg-sheet p-0.5">
                {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAssume({ ...assume, saleShare: v })}
                    aria-pressed={assume.saleShare === v}
                    className={`rounded-[4px] px-2.5 py-1 tabular transition-colors ${assume.saleShare === v ? "bg-ink font-semibold text-sheet" : "text-muted hover:text-ink"}`}
                  >
                    {v * 100}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {changeNote && !loading && (
        <p aria-live="polite" className="mt-3 rounded-md border-l-[3px] border-ink bg-sheet px-3.5 py-2 text-[13px] text-ink-soft">
          {changeNote}
        </p>
      )}

      {/* Option tabs: each one is also the at-a-glance comparison */}
      <div role="tablist" aria-label="Ownership options" onKeyDown={onTabKey} className={`mt-4 grid grid-cols-2 gap-2 ${shown.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {shown.map((o) => {
          const st = structures?.find((x) => x.option === o);
          const cost = result ? (onSale ? savingOf(o) : totalOf(o)) : null;
          const delta = result && best && cost != null ? Math.abs(score(o) - score(best)) : null;
          const selected = o === tab;
          const isBest = o === soleBest;
          return (
            <button
              key={o}
              id={`tab-${o}`}
              role="tab"
              aria-selected={selected}
              aria-controls="option-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(o)}
              className={`group relative flex items-start gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors ${
                selected ? "bg-ink text-sheet" : `bg-sheet hover:bg-sage-soft ${isBest ? "edged" : "border border-rule"}`
              }`}
            >
              <span
                className={`wide grid size-8 shrink-0 place-items-center rounded-[3px] text-[16px] font-extrabold ${
                  isBest ? "bg-edge text-sheet" : selected ? "bg-sheet text-ink" : "bg-ink text-sheet"
                }`}
              >
                {o}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[13px] font-semibold leading-tight">{st?.name ?? "…"}</span>
                <span className="wide tabular mt-1 block text-[18px] font-bold leading-none">{cost == null ? "…" : gbp(cost)}</span>
                <span className={`mt-1 block text-[11px] leading-tight ${selected ? "text-sheet/70" : isBest ? "font-medium text-edge" : "text-muted"}`}>
                  {onSale
                    ? cost == null
                      ? ""
                      : cost === 0
                        ? "No saving: next buyer pays full SDLT"
                        : isBest
                          ? "Saved on sale, the most"
                          : delta === 0
                            ? "Saved on sale, joint most"
                            : `Saved on sale, ${gbp(delta)} less than best`
                    : isBest
                      ? `Lowest ${horizon === "purchase" ? "on purchase" : `over ${HORIZON_LABEL[horizon]}`}`
                      : delta == null
                        ? ""
                        : delta === 0
                          ? "Joint lowest"
                          : `+${gbp(delta)} vs lowest`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected option */}
      <section
        id="option-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className={`mt-3 overflow-hidden rounded-md border border-rule bg-sheet transition-opacity ${loading ? "opacity-50" : ""}`}
        aria-busy={loading}
      >
        <div className="h-[max(340px,calc(100vh-25rem))]">{s && result ? <StructureChart structure={s} rows={result.rows} large /> : <div className="survey-grid h-full" />}</div>
        <div className="grid gap-6 border-t border-rule px-5 py-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
          <dl className="flex gap-6">
            {result && onSale &&
              (() => {
                const v = saleSaving(result, tab);
                const parts: [string, number, typeof v.rows.direct][] = [
                  ["Buyer's SDLT, bought directly", v.directSdlt, v.rows.direct],
                  [
                    tab === "A" ? "Buyer's SDLT, this sale" : v.rows.sale[0]?.tax === "STAMP_DUTY_UNITS" ? "Buyer's stamp duty on fund units" : "Buyer's stamp duty on shares",
                    v.saleDuty,
                    v.rows.sale,
                  ],
                ];
                return (
                  <>
                    {parts.map(([label, n, r]) => (
                      <div key={label}>
                        <dt className="whitespace-nowrap text-[12px] text-muted">{label}</dt>
                        <dd className="wide tabular text-[20px] font-bold">
                          <CostMoney title={`Option ${tab}, ${label.toLowerCase()}`} rows={r} amount={n} />
                        </dd>
                      </div>
                    ))}
                    <div className="border-l border-rule pl-6">
                      <dt className="whitespace-nowrap text-[12px] text-muted">Saved on sale</dt>
                      <dd className={`wide tabular text-[20px] font-bold ${tab === soleBest ? "text-edge" : ""}`}>{gbp(v.saving)}</dd>
                    </div>
                  </>
                );
              })()}
            {result && !onSale &&
              (() => {
                const b = breakdown(result, tab, horizon, family, assume);
                const parts: [string, number, typeof b.rows.purchase, string?][] = [
                  ["On purchase", b.purchase, b.rows.purchase],
                  [`Yearly × ${b.years}`, b.yearly, b.rows.yearly],
                  [`10-year × ${b.decades}`, b.tenYear, b.rows.tenYear],
                  ["IHT on a death", b.death, b.rows.death],
                  ["Back in the sale price", b.sale, b.rows.sale, saleNote(result, tab, assume)],
                ];
                return (
                  <>
                    {parts
                      .filter(([, v]) => v !== 0)
                      .map(([label, v, r, note]) => (
                        <div key={label}>
                          <dt className="whitespace-nowrap text-[12px] text-muted">{label}</dt>
                          <dd className="wide tabular text-[20px] font-bold">
                            <CostMoney title={`Option ${tab}, ${label.toLowerCase()}`} rows={r} amount={v} note={note} />
                          </dd>
                        </div>
                      ))}
                    {horizon !== "purchase" && (
                      <div className="border-l border-rule pl-6">
                        <dt className="whitespace-nowrap text-[12px] text-muted">Total, {HORIZON_LABEL[horizon]}</dt>
                        <dd className={`wide tabular text-[20px] font-bold ${tab === soleBest ? "text-edge" : ""}`}>{gbp(b.total)}</dd>
                      </div>
                    )}
                  </>
                );
              })()}
          </dl>
          <div className="min-w-0 space-y-2">{result && <FlagList flags={result.flags} option={tab} />}</div>
          <Link
            href={`/setup/${encodeURIComponent(packet.id)}/${tab}?investor=${preset}`}
            className={`whitespace-nowrap rounded-md px-5 py-3 text-center text-[14px] font-semibold transition-colors ${
              tab === soleBest ? "bg-edge text-sheet hover:bg-edge/90" : "bg-ink text-sheet hover:bg-ink-soft"
            }`}
          >
            Set up option {tab}
          </Link>
        </div>
      </section>

      {/* Floating comparison panel */}
      {panelOpen ? (
        <aside
          aria-label="Comparison"
          className="z-30 mt-5 flex flex-col overflow-hidden rounded-md border border-rule bg-sheet shadow-[0_12px_40px_-12px_rgba(23,38,42,0.35)] lg:fixed lg:bottom-11 lg:right-4 lg:top-[4.25rem] lg:mt-0 lg:w-[350px] xl:right-6 xl:w-[380px]"
        >
          <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
            <h2 className="text-[14px] font-semibold">Compare and save</h2>
            <button
              onClick={onExport}
              disabled={!result || exporting}
              className="ml-auto mr-1 rounded-md border border-ink px-2.5 py-1 text-[12px] font-semibold transition-colors hover:bg-ink hover:text-sheet disabled:opacity-40"
            >
              {exporting ? "Preparing…" : "Download PDF"}
            </button>
            <button onClick={() => setPanelOpen(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-paper hover:text-ink">
              Hide
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {plan && (
              <section className="rounded-md border-l-[3px] border-edge bg-edge-soft/50 px-3 py-2.5">
                <h3 className="text-[13px] font-semibold">Your optimised plan</h3>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  {plan.best.groups.length === 1
                    ? `All ${plan.best.item_ids.length} lots through option ${plan.best.groups[0].option}.`
                    : `${plan.best.groups.length} separate purchases: ${plan.best.groups.map((g) => `${g.item_ids.length} lot${g.item_ids.length > 1 ? "s" : ""} via ${g.option}`).join(", ")}.`}{" "}
                  {gbp(plan.best.cost)} in tax over {plan.horizon_years} years
                  {plan.single.cost > plan.best.cost ? `, ${gbp(plan.single.cost - plan.best.cost)} less than one structure` : ""}.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {plan.best.groups.map((g, i) => (
                    <button key={i} onClick={() => setTab(g.option)} className="rounded-full border border-ink px-2 py-0.5 text-[11px] font-semibold hover:bg-ink hover:text-sheet">
                      See {g.option}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              {onSale ? (
                <>
                  <h3 className="text-[13px] font-semibold">What each option saves when you sell</h3>
                  <div className="mt-2 h-44">{result && <SaleChart result={result} options={shown} />}</div>
                  <div className="mt-3">{result && <SaleTable result={result} best={soleBest} onPick={setTab} options={shown} />}</div>
                  <p className="mt-2 text-[11px] text-faint">
                    Selling the company or fund instead of the properties: the next buyer pays 0.5% stamp duty on company shares, or none on fund units, instead of SDLT on the properties. The saving is theirs, so a seller can ask for some of it in the price. Today&apos;s prices; capital gains tax not counted.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-[13px] font-semibold">What each option costs over {HORIZON_LABEL[horizon].toLowerCase()}</h3>
                  <div className="mt-2 h-44">{result && <TotalsChart result={result} horizon={horizon} family={family} assume={assume} options={shown} />}</div>
                  <div className="mt-3">{result && <TotalsTable result={result} horizon={horizon} family={family} best={soleBest} onPick={setTab} assume={assume} options={shown} />}</div>
                  <p className="mt-2 text-[11px] text-faint">
                    {horizon.startsWith("25y") && family ? "Assumes one death in 25 years: without a trust the family pays 40% inheritance tax above the nil-rate band. " : ""}
                    {showRelief && assume.atedRelief ? "ATED relief assumed: properties let commercially. " : ""}
                    {showShare
                      ? `Sold after 25 years as a company: the next buyer saves stamp duty and you get ${assume.saleShare * 100}% of that back in the price. Today's prices; capital gains tax not counted.`
                      : "Sale not counted here: see 25 years, then sell."}
                  </p>
                </>
              )}
            </section>
            <div className="-mx-4 border-t border-rule-soft" />
            <CliffPanel cliffs={shownCliffs} loading={loading || (!!result && !cliffs)} bare />
            {result && family && (
              <section className="rounded-md bg-ink p-4 text-sheet [&_button]:border-sheet/30 [&_button:hover]:bg-sheet/10 [&_button:hover]:text-sheet">
                <h3 className="mb-2 text-[12px] font-medium opacity-70">Option D, family trust</h3>
                <OptionDTimelineDark result={result} />
              </section>
            )}
            <p className="text-[12px] leading-snug text-muted">Select any £ figure to see its formula, inputs, source rows and the rule it applied.</p>
          </div>
        </aside>
      ) : (
        <button
          onClick={() => setPanelOpen(true)}
          className="fixed bottom-12 right-6 z-30 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-sheet shadow-lg hover:bg-ink-soft"
        >
          Compare and save{shownCliffs && shownCliffs.length > 0 ? ` (${shownCliffs.length} savings)` : ""}
        </button>
      )}
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

/** One sentence on what switching investors changed: costs per option, then structure differences. */
function describeChange(
  before: { structures: Structure[]; result: EngineResult },
  after: { structures: Structure[]; result: EngineResult },
  who: string,
): string {
  const total = (r: EngineResult, o: OptionId) => (r.totals[o]?.acquire ?? 0) + (r.totals[o]?.hold ?? 0);
  const costs = OPTIONS.flatMap((o) => {
    const d = total(after.result, o) - total(before.result, o);
    return d === 0 ? [] : [`${o} ${d > 0 ? "up" : "down"} ${gbp(Math.abs(d))}`];
  });
  const fund = (ss: Structure[]) => ss.find((s) => s.option === "C")?.nodes.find((n) => n.kind === "fund");
  const fb = fund(before.structures);
  const fa = fund(after.structures);
  const structural = fb && fa && fb.label !== fa.label ? `the fund in C becomes a ${fa.jurisdiction === "Jersey" ? "Jersey " : "UK "}${fa.label}` : null;
  const newFlags = after.result.flags.length - before.result.flags.length;
  const parts = [
    costs.length ? `purchase and first-year costs: ${costs.join(", ")}` : "costs are unchanged (stamp duty on these lots doesn't depend on who buys)",
    structural,
    newFlags > 0 ? `${newFlags} new note${newFlags > 1 ? "s" : ""} to check` : null,
  ].filter(Boolean);
  return `Switched to ${who}: ${parts.join("; ")}.`;
}
