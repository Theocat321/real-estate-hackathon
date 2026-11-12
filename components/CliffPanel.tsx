"use client";

import type { Cliff } from "@/engine/cliffs";
import { CostMoney } from "@/components/SourceDrawer";
import { gbp } from "@/lib/api";

/** "Thresholds near this packet": small changes that move the tax a lot. */
export function CliffPanel({ cliffs, loading, bare = false }: { cliffs: Cliff[] | null; loading: boolean; bare?: boolean }) {
  return (
    <section className={bare ? "" : "rounded-md border border-rule bg-sheet p-4"}>
      <h2 className={`font-semibold ${bare ? "text-[13px]" : "text-[14px]"}`}>Thresholds near this packet</h2>
      <p className="mt-0.5 text-[12px] leading-snug text-muted">Small changes that move the tax a lot, priced by re-running the engine.</p>
      {loading && !cliffs && <p className="mt-3 text-[12px] text-muted">Checking thresholds…</p>}
      {cliffs && cliffs.length === 0 && <p className="mt-3 text-[12px] text-muted">No thresholds within reach of this packet.</p>}
      {cliffs && cliffs.length > 0 && (
        <ul className="mt-3 space-y-3">
          {cliffs.map((c) => (
            <li key={c.id} className="border-l-[3px] border-edge pl-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold leading-snug">{c.title}</h3>
                <p className="wide tabular shrink-0 text-[15px] font-bold text-edge">
                  <CostMoney
                    title={`Option ${c.best.option} after: ${c.title.toLowerCase()}`}
                    rows={c.probe_rows}
                    note={`What option ${c.best.option} would cost after the change. The saving is today's cost minus this, from two runs of the same engine.`}
                    display={`−${gbp(c.best.acquire + c.best.hold)}`}
                  />
                </p>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{c.detail}</p>
              <p className="mt-1 text-[12px] text-muted">
                Best in option {c.best.option}: {gbp(c.best.acquire)} on purchase
                {c.best.hold > 0 && <>, {gbp(c.best.hold)} a year</>}
                {c.best.ten_year > 0 && <>, {gbp(c.best.ten_year)} each 10 years</>}.
                {c.severity === "review" && <span className="ml-1 font-medium text-review">Ask an adviser.</span>}
              </p>
              {c.added && (
                <ul className="mt-1 text-[12px] text-ink-soft">
                  {c.added.map((p) => (
                    <li key={p.id} className="truncate">
                      + {p.address}, {gbp(p.price_gbp?.value)} <span className="text-faint">({p.price_gbp?.source.file}, row {p.price_gbp?.source.row})</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
