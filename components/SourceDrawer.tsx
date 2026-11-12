"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useState } from "react";
import type { CostRow, SourceRef, Sourced } from "@/contracts";
import { gbp } from "@/lib/api";

/** What the drawer explains: a raw sourced data value, or an engine cost row. */
export type DrawerItem =
  | { kind: "sourced"; title: string; display: string; sourced: Sourced<number> }
  | { kind: "cost"; title: string; row: CostRow }
  | { kind: "sum"; title: string; amount: number; rows: CostRow[]; note?: string }
  | { kind: "parts"; title: string; display: string; note: string; parts: { label: string; sourced: Sourced<number> }[] };

const Ctx = createContext<(item: DrawerItem) => void>(() => {});
export const useSourceDrawer = () => useContext(Ctx);

export function SourceDrawerProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<DrawerItem | null>(null);
  const open = useCallback((i: DrawerItem) => setItem(i), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <Dialog.Root open={item !== null} onOpenChange={(o) => !o && setItem(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/20" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-xl focus:outline-none">
            {item && <DrawerBody item={item} />}
            <Dialog.Close className="absolute right-4 top-4 rounded px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
              ✕
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

function DrawerBody({ item }: { item: DrawerItem }) {
  if (item.kind === "sourced") {
    return (
      <>
        <Dialog.Title className="pr-8 text-sm font-medium text-slate-500">{item.title}</Dialog.Title>
        <p className="tabular mt-1 text-3xl font-semibold">{item.display}</p>
        <Dialog.Description className="mt-1 text-xs text-slate-500">Taken directly from the source data. No calculation applied.</Dialog.Description>
        <Section label="Source">
          <SourceCard source={item.sourced.source} />
        </Section>
      </>
    );
  }
  if (item.kind === "parts") {
    return (
      <>
        <Dialog.Title className="pr-8 text-sm font-medium text-slate-500">{item.title}</Dialog.Title>
        <p className="tabular mt-1 text-3xl font-semibold">{item.display}</p>
        <Dialog.Description className="mt-1 text-xs text-slate-500">{item.note}</Dialog.Description>
        <Section label="Inputs">
          <ul className="space-y-2">
            {item.parts.map((p, i) => (
              <li key={i} className="rounded border border-slate-100 p-2">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-slate-600">{p.label}</span>
                  <span className="tabular font-medium">{gbp(p.sourced.value)}</span>
                </div>
                <SourceCard source={p.sourced.source} compact />
              </li>
            ))}
          </ul>
        </Section>
      </>
    );
  }
  if (item.kind === "sum") {
    return (
      <>
        <Dialog.Title className="pr-8 text-sm font-medium text-slate-500">{item.title}</Dialog.Title>
        <p className="tabular mt-1 text-3xl font-semibold">{gbp(item.amount)}</p>
        <Dialog.Description className="mt-1 text-xs text-slate-500">
          {item.note ?? `Sum of ${item.rows.length} cost row${item.rows.length === 1 ? "" : "s"} from the engine.`}
        </Dialog.Description>
        <Section label="Rows">
          <ul className="space-y-4">
            {item.rows.map((r, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-3">
                <RowDetail row={r} />
              </li>
            ))}
          </ul>
        </Section>
      </>
    );
  }
  const r = item.row;
  return (
    <>
      <Dialog.Title className="pr-8 text-sm font-medium text-slate-500">{item.title}</Dialog.Title>
      <p className="tabular mt-1 text-3xl font-semibold">{gbp(r.amount_gbp)}</p>
      <Dialog.Description className="mt-1 text-xs text-slate-500">
        Option {r.option} · stage {r.stage.replace("_", " ")} · {r.tax}
      </Dialog.Description>
      <div className="mt-4">
        <RowDetail row={r} />
      </div>
    </>
  );
}

function RowDetail({ row }: { row: CostRow }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{row.tax}</span>
        <span className="tabular font-semibold">{gbp(row.amount_gbp)}</span>
      </div>
      <div>
        <Label>Formula</Label>
        <p className="rounded bg-slate-50 px-2 py-1 font-mono text-xs leading-relaxed">{row.formula}</p>
      </div>
      <div>
        <Label>Inputs</Label>
        <ul className="space-y-2">
          {row.inputs.map((inp, i) => (
            <li key={i} className="rounded border border-slate-100 p-2">
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-slate-600">{inp.label}</span>
                <span className="tabular font-medium">{typeof inp.value === "number" ? gbp(inp.value) : inp.value}</span>
              </div>
              <SourceCard source={inp.source} compact />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <Label>Rule</Label>
        <p className="text-xs">
          <span className="font-mono">{row.rule.id}</span> · as of {row.rule.as_of}
        </p>
        <a href={row.rule.citation_url} target="_blank" rel="noreferrer" className="break-all text-xs text-accent underline">
          {row.rule.citation_url}
        </a>
      </div>
    </div>
  );
}

export function SourceCard({ source, compact }: { source: SourceRef; compact?: boolean }) {
  const loc = [source.file, source.row != null ? `row ${source.row}` : null, source.page != null ? `page ${source.page}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={compact ? "mt-1 text-[11px] text-slate-500" : "rounded-lg border border-slate-200 p-3 text-sm"}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">{source.kind}</span>
        <span className="font-mono">{loc}</span>
        {source.record_id && <span className="font-mono text-slate-400">({source.record_id})</span>}
      </div>
      {source.excerpt && <p className="mt-1 italic text-slate-600">“{source.excerpt}”</p>}
      {source.url && (
        <a href={source.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-accent underline">
          {source.url}
        </a>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{children}</p>;
}

/* ───────────────────────── Clickable money ───────────────────────── */

const moneyCls =
  "tabular cursor-pointer rounded px-0.5 underline decoration-dotted decoration-slate-300 underline-offset-4 hover:bg-accent-soft hover:text-accent hover:decoration-accent";

/** A £ (or %) value straight from source data. */
export function SourcedMoney({ title, sourced, format = "gbp", className = "" }: {
  title: string;
  sourced: Sourced<number> | null;
  format?: "gbp" | "pct";
  className?: string;
}) {
  const open = useSourceDrawer();
  if (!sourced) return <span className="text-slate-400">—</span>;
  const display = format === "pct" ? `${sourced.value.toFixed(2)}%` : gbp(sourced.value);
  return (
    <button type="button" className={`${moneyCls} ${className}`} onClick={() => open({ kind: "sourced", title, display, sourced })}>
      {display}
    </button>
  );
}

/** A £ produced by one or more engine CostRows. */
export function CostMoney({ title, rows, amount, note, className = "" }: {
  title: string;
  rows: CostRow[];
  amount?: number;
  note?: string;
  className?: string;
}) {
  const open = useSourceDrawer();
  const total = amount ?? rows.reduce((s, r) => s + r.amount_gbp, 0);
  if (rows.length === 0) return <span className={`tabular text-slate-400 ${className}`}>{gbp(total)}</span>;
  return (
    <button
      type="button"
      className={`${moneyCls} ${className}`}
      onClick={() => open(rows.length === 1 && amount == null ? { kind: "cost", title, row: rows[0] } : { kind: "sum", title, amount: total, rows, note })}
    >
      {gbp(total)}
    </button>
  );
}

/** A derived figure (e.g. packet total) with its sourced parts listed. */
export function PartsMoney({ title, display, note, parts, className = "" }: {
  title: string;
  display: string;
  note: string;
  parts: { label: string; sourced: Sourced<number> }[];
  className?: string;
}) {
  const open = useSourceDrawer();
  if (parts.length === 0) return <span className={`tabular text-slate-400 ${className}`}>{display}</span>;
  return (
    <button type="button" className={`${moneyCls} ${className}`} onClick={() => open({ kind: "parts", title, display, note, parts })}>
      {display}
    </button>
  );
}
