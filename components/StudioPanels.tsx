"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CostRow, EngineResult, Flag, OptionId, Stage } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";
import { OPTIONS, STAGES, gbp } from "@/lib/api";

const STAGE_LABEL: Record<Stage, string> = {
  acquire: "Acquire",
  hold: "Hold (p.a.)",
  exit: "Exit",
  ten_year: "10-year",
  death: "Death (comparator)",
};
const STAGE_COLOR: Record<Stage, string> = {
  acquire: "#2f5bea",
  hold: "#7c93f0",
  exit: "#0f766e",
  ten_year: "#9333ea",
  death: "#cbd5e1",
};

/** Grouped bar: totals by option × stage. */
export function TotalsChart({ result }: { result: EngineResult }) {
  const stages = STAGES.filter((s) => OPTIONS.some((o) => (result.totals[o]?.[s] ?? 0) > 0));
  const data = OPTIONS.map((o) => ({ option: `Option ${o}`, ...Object.fromEntries(stages.map((s) => [s, result.totals[o]?.[s] ?? 0])) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="option" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v: number) => (v >= 1000 ? `£${Math.round(v / 1000)}k` : `£${v}`)} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip formatter={(v) => gbp(Number(v))} cursor={{ fill: "#f8fafc" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        {stages.map((s) => (
          <Bar key={s} dataKey={s} name={STAGE_LABEL[s]} fill={STAGE_COLOR[s]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Compact totals table, every figure clickable. */
export function TotalsTable({ result }: { result: EngineResult }) {
  const stages = STAGES.filter((s) => OPTIONS.some((o) => result.totals[o]?.[s] != null));
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="font-medium" />
          {stages.map((s) => (
            <th key={s} className="pb-1 text-right font-medium">
              {STAGE_LABEL[s]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {OPTIONS.map((o) => (
          <tr key={o} className="border-t border-slate-100">
            <td className="py-1 font-medium">{o}</td>
            {stages.map((s) => {
              const rows = result.rows.filter((r) => r.option === o && r.stage === s);
              return (
                <td key={s} className="text-right">
                  {result.totals[o]?.[s] == null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <CostMoney
                      title={`Option ${o} · ${STAGE_LABEL[s]}`}
                      rows={rows}
                      amount={result.totals[o]?.[s]}
                      className={s === "death" ? "text-slate-400" : ""}
                    />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Option D: "Pay £X now or £Y later". */
export function OptionDTimeline({ result }: { result: EngineResult }) {
  const rows = (tax: CostRow["tax"]) => result.rows.filter((r) => r.option === "D" && r.tax === tax);
  const entry = rows("IHT_ENTRY");
  const ten = rows("IHT_TEN_YEAR");
  const death = rows("IHT_DEATH_COMPARATOR");
  const sum = (rs: CostRow[]) => rs.reduce((s, r) => s + r.amount_gbp, 0);
  if (entry.length + ten.length + death.length === 0) return null;
  const k = (n: number) => (n >= 1000 ? `£${Math.round(n / 1000)}k` : gbp(n));
  const steps = [
    { label: "Now · into trust", rows: entry, tone: "bg-purple-600" },
    { label: "Every 10 years (max)", rows: ten, tone: "bg-purple-400" },
    { label: "On death, held personally", rows: death, tone: "bg-slate-300", note: "comparator, not a cost of D" },
  ];
  return (
    <div>
      <p className="text-sm font-medium">
        Pay {k(sum(entry))} now or {k(sum(death))} later
      </p>
      <div className="mt-3 flex items-start gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex-1">
            <div className={`h-1.5 rounded ${s.tone}`} />
            <p className="mt-1 text-[11px] text-slate-500">{s.label}</p>
            <p className="text-sm font-semibold">
              <CostMoney title={`Option D · ${s.label}`} rows={s.rows} />
            </p>
            {s.note && <p className="text-[10px] text-slate-400">{s.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FlagList({ flags, option }: { flags: Flag[]; option: OptionId }) {
  const mine = flags.filter((f) => f.option === option);
  if (mine.length === 0) return <p className="text-[11px] text-slate-400">No flags.</p>;
  return (
    <ul className="space-y-1">
      {mine.map((f, i) => (
        <li
          key={`${f.rule_id}-${i}`}
          className={`rounded px-2 py-1 text-[11px] leading-snug ${f.severity === "review" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}
        >
          <span className="mr-1 font-medium uppercase tracking-wide">{f.severity}</span>
          {f.message}
          {f.citation_url && (
            <a href={f.citation_url} target="_blank" rel="noreferrer" className="ml-1 underline">
              source
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
