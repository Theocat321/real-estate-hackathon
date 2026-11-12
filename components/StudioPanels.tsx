"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CostRow, EngineResult, Flag, OptionId, Stage } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";
import { OPTIONS, STAGES, gbp } from "@/lib/api";

export const STAGE_LABEL: Record<Stage, string> = {
  acquire: "On purchase",
  hold: "Each year",
  exit: "On sale",
  ten_year: "Every 10 years",
  death: "On death (if held personally)",
};
const STAGE_COLOR: Record<Stage, string> = {
  acquire: "#17262a",
  hold: "#5e8a7c",
  exit: "#9fb8ae",
  ten_year: "#b8202f",
  death: "#cdd5d0",
};

const k = (v: number) => (v >= 1000 ? `£${Math.round(v / 1000)}k` : `£${v}`);

/** Stacked bar: cost by option and stage. Death comparator excluded (not a cost of any option). */
export function TotalsChart({ result }: { result: EngineResult }) {
  const stages = STAGES.filter((s) => s !== "death" && OPTIONS.some((o) => (result.totals[o]?.[s] ?? 0) > 0));
  const data = OPTIONS.map((o) => ({ option: o, ...Object.fromEntries(stages.map((s) => [s, result.totals[o]?.[s] ?? 0])) }));
  return (
    <div className="flex h-full flex-col">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {stages.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: STAGE_COLOR[s] }} />
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ul>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#e2e7e3" />
            <XAxis dataKey="option" tick={{ fontSize: 12, fill: "#17262a", fontWeight: 600 }} axisLine={{ stroke: "#cdd5d0" }} tickLine={false} />
            <YAxis tickFormatter={k} tick={{ fontSize: 11, fill: "#5e6f6b" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              formatter={(v, name) => [gbp(Number(v)), name]}
              labelFormatter={(l) => `Option ${l}`}
              cursor={{ fill: "#eef1ec" }}
              contentStyle={{ borderRadius: 4, border: "1px solid #cdd5d0", fontSize: 12 }}
            />
            {stages.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                stackId="cost"
                name={STAGE_LABEL[s]}
                fill={STAGE_COLOR[s]}
                radius={i === stages.length - 1 ? [2, 2, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Totals table, every figure clickable. */
export function TotalsTable({ result, best }: { result: EngineResult; best?: OptionId | null }) {
  const stages = STAGES.filter((s) => OPTIONS.some((o) => result.totals[o]?.[s] != null));
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] text-muted">
          <th className="pb-1.5 font-medium">Option</th>
          {stages.map((s) => (
            <th key={s} className={`pb-1.5 text-right font-medium ${s === "death" ? "text-faint" : ""}`}>
              {SHORT[s]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {OPTIONS.map((o) => (
          <tr key={o} className="border-t border-rule-soft">
            <td className={`py-1.5 font-bold ${o === best ? "text-edge" : ""}`}>{o}</td>
            {stages.map((s) => {
              const rows = result.rows.filter((r) => r.option === o && r.stage === s);
              return (
                <td key={s} className="text-right">
                  {result.totals[o]?.[s] == null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <CostMoney title={`Option ${o}, ${STAGE_LABEL[s].toLowerCase()}`} rows={rows} amount={result.totals[o]?.[s]} className={s === "death" ? "text-faint" : ""} />
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
const SHORT: Record<Stage, string> = { acquire: "Purchase", hold: "Yearly", exit: "Sale", ten_year: "10-year", death: "Death*" };

/** Option D: "Pay £X now or £Y later". */
export function OptionDTimeline({ result }: { result: EngineResult }) {
  const rows = (tax: CostRow["tax"]) => result.rows.filter((r) => r.option === "D" && r.tax === tax);
  const entry = rows("IHT_ENTRY");
  const ten = rows("IHT_TEN_YEAR");
  const death = rows("IHT_DEATH_COMPARATOR");
  const sum = (rs: CostRow[]) => rs.reduce((s, r) => s + r.amount_gbp, 0);
  if (entry.length + ten.length + death.length === 0) return null;
  const steps = [
    { label: "Now, into trust", rows: entry, tone: "bg-ink" },
    { label: "Each 10 years, at most", rows: ten, tone: "bg-edge" },
    { label: "On death, if held personally", rows: death, tone: "bg-rule", note: "Comparison only. Not a cost of D." },
  ];
  return (
    <div>
      <p className="wide text-[18px] font-bold leading-tight tracking-tight">
        Pay {k(sum(entry))} now, or {k(sum(death))} later
      </p>
      <ol className="mt-4 grid grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <li key={i}>
            <div className={`h-1 rounded-full ${s.tone}`} />
            <p className="mt-2 text-[12px] leading-tight text-muted">{s.label}</p>
            <p className="mt-0.5 text-[15px] font-semibold">
              <CostMoney title={`Option D, ${s.label.toLowerCase()}`} rows={s.rows} />
            </p>
            {s.note && <p className="mt-0.5 text-[11px] leading-tight text-faint">{s.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function FlagList({ flags, option }: { flags: Flag[]; option: OptionId }) {
  const mine = flags.filter((f) => f.option === option);
  if (mine.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {mine.map((f, i) => (
        <li key={`${f.rule_id}-${i}`} className="flex gap-2 text-[12px] leading-snug">
          <span
            className={`mt-[3px] h-fit shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${
              f.severity === "review" ? "bg-review-soft text-review" : "bg-paper text-muted"
            }`}
          >
            {f.severity === "review" ? "Ask an adviser" : "Note"}
          </span>
          <span className="text-ink-soft">
            {f.message}
            {f.citation_url && (
              <a href={f.citation_url} target="_blank" rel="noreferrer" className="ml-1 underline decoration-rule underline-offset-2 hover:decoration-ink">
                Rule source
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
