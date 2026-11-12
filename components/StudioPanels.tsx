"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CostRow, EngineResult, Flag, OptionId, Stage } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";
import { OPTIONS, gbp } from "@/lib/api";
import { HORIZON_LABEL, breakdown, type Breakdown, type Horizon } from "@/lib/horizon";

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

const PART_COLOR = { purchase: "#17262a", yearly: "#5e8a7c", tenYear: "#9fb8ae", death: "#b8202f" } as const;
const PART_LABEL = { purchase: "On purchase", yearly: "Yearly charges", tenYear: "10-year trust charges", death: "Inheritance tax on a death" } as const;
type Part = keyof typeof PART_COLOR;
const PARTS: Part[] = ["purchase", "yearly", "tenYear", "death"];

/** Stacked bar: what each option costs over the chosen period. */
export function TotalsChart({ result, horizon, family }: { result: EngineResult; horizon: Horizon; family: boolean }) {
  const b = Object.fromEntries(OPTIONS.map((o) => [o, breakdown(result, o, horizon, family)])) as Record<OptionId, Breakdown>;
  const parts = PARTS.filter((p) => OPTIONS.some((o) => b[o][p] > 0));
  const data = OPTIONS.map((o) => ({ option: o, ...Object.fromEntries(parts.map((p) => [p, b[o][p]])) }));
  return (
    <div className="flex h-full flex-col">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {parts.map((p) => (
          <li key={p} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: PART_COLOR[p] }} />
            {PART_LABEL[p]}
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
            {parts.map((p, i) => (
              <Bar key={p} dataKey={p} stackId="cost" name={PART_LABEL[p]} fill={PART_COLOR[p]} radius={i === parts.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Totals table for the chosen period, every figure clickable. */
export function TotalsTable({
  result,
  horizon,
  family,
  best,
  onPick,
}: {
  result: EngineResult;
  horizon: Horizon;
  family: boolean;
  best?: OptionId | null;
  onPick?: (o: OptionId) => void;
}) {
  const b = Object.fromEntries(OPTIONS.map((o) => [o, breakdown(result, o, horizon, family)])) as Record<OptionId, Breakdown>;
  const parts = PARTS.filter((p) => OPTIONS.some((o) => b[o][p] > 0));
  const short: Record<Part, string> = { purchase: "Purchase", yearly: "Yearly", tenYear: "10-year", death: "Death" };
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] text-muted">
          <th className="pb-1.5 font-medium">Option</th>
          {parts.map((p) => (
            <th key={p} className="pb-1.5 text-right font-medium">
              {short[p]}
            </th>
          ))}
          <th className="pb-1.5 text-right font-semibold text-ink">Total</th>
        </tr>
      </thead>
      <tbody>
        {OPTIONS.map((o) => (
          <tr key={o} className="border-t border-rule-soft">
            <td className={`py-1.5 font-bold ${o === best ? "text-edge" : ""}`}>
              {onPick ? (
                <button onClick={() => onPick(o)} className="rounded px-1 hover:bg-paper" aria-label={`Show option ${o}`}>
                  {o}
                </button>
              ) : (
                o
              )}
            </td>
            {parts.map((p) => (
              <td key={p} className="text-right">
                {b[o][p] === 0 ? (
                  <span className="text-faint">—</span>
                ) : (
                  <CostMoney title={`Option ${o}, ${PART_LABEL[p].toLowerCase()}, ${HORIZON_LABEL[horizon].toLowerCase()}`} rows={b[o].rows[p]} amount={b[o][p]} />
                )}
              </td>
            ))}
            <td className={`tabular text-right font-semibold ${o === best ? "text-edge" : ""}`}>{gbp(b[o].total)}</td>
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
