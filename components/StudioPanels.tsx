"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CostRow, EngineResult, Flag, OptionId, Stage } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";
import { OPTIONS, gbp } from "@/lib/api";
import { DEFAULT_ASSUMPTIONS, HORIZON_LABEL, breakdown, saleSaving, type Assumptions, type Breakdown, type Horizon } from "@/lib/horizon";

export const STAGE_LABEL: Record<Stage, string> = {
  acquire: "On purchase",
  hold: "Each year",
  exit: "On sale",
  ten_year: "Every 10 years",
  death: "On death (family's share, if held personally)",
};
const STAGE_COLOR: Record<Stage, string> = {
  acquire: "#17262a",
  hold: "#5e8a7c",
  exit: "#9fb8ae",
  ten_year: "#1f5a8a",
  death: "#cdd5d0",
};


const PART_COLOR = { purchase: "#17262a", yearly: "#5e8a7c", tenYear: "#9fb8ae", death: "#1f5a8a", sale: "#c9a227" } as const;
const PART_LABEL = {
  purchase: "On purchase",
  yearly: "Yearly charges",
  tenYear: "10-year trust charges",
  death: "Inheritance tax on a death",
  sale: "Back in the sale price",
} as const;
type Part = keyof typeof PART_COLOR;
const PARTS: Part[] = ["purchase", "yearly", "tenYear", "death", "sale"];

/** Drawer note for the sale part: how the amount got back was worked out. */
export function saleNote(result: EngineResult, o: OptionId, a: Assumptions): string {
  const s = saleSaving(result, o);
  return `Next buyer pays ${gbp(s.saleDuty)} stamp duty on the ${s.rows.sale[0]?.tax === "STAMP_DUTY_UNITS" ? "fund units" : "shares"} instead of ${gbp(s.directSdlt)} SDLT buying the properties, saving ${gbp(s.saving)}. Assumes you get ${Math.round(a.saleShare * 100)}% of that back in the price. Today's prices.`;
}

/** Stacked bar: what each option costs over the chosen period. */
export function TotalsChart({ result, horizon, family, assume = DEFAULT_ASSUMPTIONS, options = OPTIONS }: { result: EngineResult; horizon: Horizon; family: boolean; assume?: Assumptions; options?: OptionId[] }) {
  const b = Object.fromEntries(options.map((o) => [o, breakdown(result, o, horizon, family, assume)])) as Record<OptionId, Breakdown>;
  const parts = PARTS.filter((p) => options.some((o) => b[o][p] !== 0));
  const data = options.map((o) => ({ option: o, ...Object.fromEntries(parts.map((p) => [p, b[o][p]])) }));
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
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%" stackOffset="sign">
            <CartesianGrid vertical={false} stroke="#e2e7e3" />
            <XAxis dataKey="option" tick={{ fontSize: 12, fill: "#17262a", fontWeight: 600 }} axisLine={{ stroke: "#cdd5d0" }} tickLine={false} />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "#5e6f6b" }} axisLine={false} tickLine={false} width={44} />
            {parts.includes("sale") && <ReferenceLine y={0} stroke="#17262a" />}
            <Tooltip
              formatter={(v, name) => [gbp(Number(v)), name]}
              labelFormatter={(l) => `Option ${l}`}
              cursor={{ fill: "#eef1ec" }}
              contentStyle={{ borderRadius: 4, border: "1px solid #cdd5d0", fontSize: 12 }}
            />
            {parts.map((p, i) => (
              <Bar key={p} dataKey={p} stackId="cost" name={PART_LABEL[p]} fill={PART_COLOR[p]} radius={p === "sale" ? [0, 0, 2, 2] : i === parts.filter((x) => x !== "sale").length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />
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
  assume = DEFAULT_ASSUMPTIONS,
  options = OPTIONS,
}: {
  result: EngineResult;
  horizon: Horizon;
  family: boolean;
  best?: OptionId | null;
  onPick?: (o: OptionId) => void;
  assume?: Assumptions;
  options?: OptionId[];
}) {
  const b = Object.fromEntries(options.map((o) => [o, breakdown(result, o, horizon, family, assume)])) as Record<OptionId, Breakdown>;
  const parts = PARTS.filter((p) => options.some((o) => b[o][p] !== 0));
  const short: Record<Part, string> = { purchase: "Purchase", yearly: "Yearly", tenYear: "10-year", death: "Death", sale: "Sale" };
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th className="px-1 pb-2 text-left font-medium">Option</th>
            {parts.map((p) => (
              <th key={p} className="px-2 pb-2 text-right font-medium">
                {short[p]}
              </th>
            ))}
            <th className="px-1 pb-2 text-right font-semibold text-ink">Total</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => {
            const isBest = o === best;
            const cell = `border-t border-rule-soft py-2 ${isBest ? "bg-edge-soft/60" : ""}`;
            return (
              <tr key={o}>
                <td className={`${cell} px-1 font-bold ${isBest ? "text-edge" : ""}`}>
                  {onPick ? (
                    <button onClick={() => onPick(o)} className="rounded px-1 hover:bg-paper" aria-label={`Show option ${o}`}>
                      {o}
                    </button>
                  ) : (
                    o
                  )}
                </td>
                {parts.map((p) => (
                  <td key={p} className={`${cell} px-2 text-right`}>
                    {b[o][p] === 0 ? (
                      <span className="text-faint">–</span>
                    ) : (
                      <span title={gbp(b[o][p])} className={b[o][p] < 0 ? "text-sage" : ""}>
                        <CostMoney
                          title={`Option ${o}, ${PART_LABEL[p].toLowerCase()}, ${HORIZON_LABEL[horizon].toLowerCase()}`}
                          rows={b[o].rows[p]}
                          amount={b[o][p]}
                          display={compact(b[o][p])}
                          note={p === "sale" ? saleNote(result, o, assume) : undefined}
                        />
                      </span>
                    )}
                  </td>
                ))}
                <td className={`${cell} tabular px-1 text-right font-semibold ${isBest ? "text-edge" : ""}`} title={gbp(b[o].total)}>
                  {compact(b[o].total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** £152k / £1.37m, with a true minus sign. Full figure lives in the drawer and tooltip. */
function compact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}£${parseFloat((a / 1_000_000).toFixed(2))}m`;
  if (a >= 1000) return `${sign}£${Math.round(a / 1000)}k`;
  return `${sign}£${Math.round(a)}`;
}

/** Bar per option: stamp duty the next buyer saves when the packet is sold through it. */
export function SaleChart({ result, options = OPTIONS }: { result: EngineResult; options?: OptionId[] }) {
  const data = options.map((o) => ({ option: o, saving: saleSaving(result, o).saving }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="#e2e7e3" />
        <XAxis dataKey="option" tick={{ fontSize: 12, fill: "#17262a", fontWeight: 600 }} axisLine={{ stroke: "#cdd5d0" }} tickLine={false} />
        <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "#5e6f6b" }} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          formatter={(v) => [gbp(Number(v)), "Saved on sale"]}
          labelFormatter={(l) => `Option ${l}`}
          cursor={{ fill: "#eef1ec" }}
          contentStyle={{ borderRadius: 4, border: "1px solid #cdd5d0", fontSize: 12 }}
        />
        <Bar dataKey="saving" name="Saved on sale" fill="#5e8a7c" radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per option: buyer's SDLT bought directly, buyer's duty on this sale, and the saving. */
export function SaleTable({ result, best, onPick, options = OPTIONS }: { result: EngineResult; best?: OptionId | null; onPick?: (o: OptionId) => void; options?: OptionId[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] text-muted">
          <th className="pb-1.5 font-medium">Option</th>
          <th className="pb-1.5 text-right font-medium">Buyer pays</th>
          <th className="pb-1.5 text-right font-semibold text-ink">Saved</th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => {
          const s = saleSaving(result, o);
          return (
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
              <td className="text-right">
                <CostMoney title={`Option ${o}, next buyer's stamp duty on sale`} rows={s.rows.sale} amount={s.saleDuty} />
              </td>
              <td className={`tabular text-right font-semibold ${o === best ? "text-edge" : ""}`}>
                {s.saving === 0 ? <span className="text-faint">—</span> : gbp(s.saving)}
              </td>
            </tr>
          );
        })}
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
    { label: "On death, family's share if held personally", rows: death, tone: "bg-rule", note: "Comparison only. Not a cost of D." },
  ];
  return (
    <div>
      <p className="wide text-[18px] font-bold leading-tight tracking-tight">
        Pay {compact(sum(entry))} now, or {compact(sum(death))} later
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
