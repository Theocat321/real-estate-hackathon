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
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/25" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col overflow-y-auto border-l-[3px] border-edge bg-sheet p-7 shadow-2xl focus:outline-none">
            {item && <DrawerBody item={item} />}
            <Dialog.Close className="absolute right-4 top-4 rounded px-2 text-muted hover:bg-paper hover:text-ink" aria-label="Close">
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
        <Dialog.Title className="pr-8 text-[13px] font-medium text-muted">{item.title}</Dialog.Title>
        <p className="wide tabular mt-1 text-[34px] font-extrabold tracking-tight">{item.display}</p>
        <Dialog.Description className="mt-1 text-[13px] text-muted">Taken directly from the source data. No calculation applied.</Dialog.Description>
        <Section label="Source">
          <SourceCard source={item.sourced.source} />
        </Section>
      </>
    );
  }
  if (item.kind === "parts") {
    return (
      <>
        <Dialog.Title className="pr-8 text-[13px] font-medium text-muted">{item.title}</Dialog.Title>
        <p className="wide tabular mt-1 text-[34px] font-extrabold tracking-tight">{item.display}</p>
        <Dialog.Description className="mt-1 text-[13px] text-muted">{item.note}</Dialog.Description>
        <Section label="Inputs">
          <ul className="space-y-2">
            {item.parts.map((p, i) => (
              <li key={i} className="rounded-md border border-rule-soft p-2.5">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-ink-soft">{p.label}</span>
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
        <Dialog.Title className="pr-8 text-[13px] font-medium text-muted">{item.title}</Dialog.Title>
        <p className="wide tabular mt-1 text-[34px] font-extrabold tracking-tight">{gbp(item.amount)}</p>
        <Dialog.Description className="mt-1 text-[13px] text-muted">
          {item.note ?? `Sum of ${item.rows.length} cost row${item.rows.length === 1 ? "" : "s"} from the engine.`}
        </Dialog.Description>
        <Section label="Rows">
          <ul className="space-y-4">
            {item.rows.map((r, i) => (
              <li key={i} className="rounded-md border border-rule p-3.5">
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
      <Dialog.Title className="pr-8 text-[13px] font-medium text-muted">{item.title}</Dialog.Title>
      <p className="wide tabular mt-1 text-[34px] font-extrabold tracking-tight">{gbp(r.amount_gbp)}</p>
      <Dialog.Description className="mt-1 text-[13px] text-muted">
        Option {r.option}, {r.stage.replace("_", " ")} stage, {r.tax}
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
        <p className="narrow rounded-md bg-paper px-2.5 py-1.5 text-[13px] leading-relaxed">{row.formula}</p>
      </div>
      <div>
        <Label>Inputs</Label>
        <ul className="space-y-2">
          {row.inputs.map((inp, i) => (
            <li key={i} className="rounded-md border border-rule-soft p-2.5">
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-ink-soft">{inp.label}</span>
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
          <span className="narrow font-medium">{row.rule.id}</span>, rates for {row.rule.as_of}
        </p>
        <a href={row.rule.citation_url} target="_blank" rel="noreferrer" className="break-all text-xs text-ink-soft underline decoration-rule underline-offset-4 hover:decoration-ink">
          {row.rule.citation_url}
        </a>
      </div>
    </div>
  );
}

export function SourceCard({ source, compact }: { source: SourceRef; compact?: boolean }) {
  const loc = [source.file, source.row != null ? `row ${source.row}` : null, source.page != null ? `page ${source.page}` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <div className={compact ? "mt-1 text-[11px] text-muted" : "rounded-md border border-rule p-3.5 text-sm"}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-ink-soft">{source.kind}</span>
        <span className="narrow">{loc}</span>
        {source.record_id && <span className="narrow text-faint">({source.record_id})</span>}
      </div>
      {source.excerpt && <p className="mt-1 italic text-ink-soft">“{source.excerpt}”</p>}
      {source.url && (
        <a href={source.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-ink-soft underline decoration-rule underline-offset-4 hover:decoration-ink">
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
  return <p className="mb-1.5 text-[12px] font-semibold text-ink">{children}</p>;
}

/* ───────────────────────── Clickable money ───────────────────────── */

const moneyCls =
  "tabular cursor-pointer rounded-[2px] border-b border-rule px-0.5 transition-colors hover:border-edge hover:bg-edge-soft hover:text-edge";

/** A £ (or %) value straight from source data. */
export function SourcedMoney({ title, sourced, format = "gbp", className = "" }: {
  title: string;
  sourced: Sourced<number> | null;
  format?: "gbp" | "pct";
  className?: string;
}) {
  const open = useSourceDrawer();
  if (!sourced) return <span className="text-faint">—</span>;
  const display = format === "pct" ? `${sourced.value.toFixed(2)}%` : gbp(sourced.value);
  return (
    <button type="button" className={`${moneyCls} ${className}`} onClick={() => open({ kind: "sourced", title, display, sourced })}>
      {display}
    </button>
  );
}

/** A £ produced by one or more engine CostRows. */
export function CostMoney({ title, rows, amount, note, display, className = "" }: {
  title: string;
  rows: CostRow[];
  amount?: number;
  note?: string;
  /** Button text override; the drawer still explains `rows`. */
  display?: string;
  className?: string;
}) {
  const open = useSourceDrawer();
  const total = amount ?? rows.reduce((s, r) => s + r.amount_gbp, 0);
  if (rows.length === 0) return <span className={`tabular text-faint ${className}`}>{gbp(total)}</span>;
  return (
    <button
      type="button"
      className={`${moneyCls} ${className}`}
      onClick={() => open(rows.length === 1 && amount == null ? { kind: "cost", title, row: rows[0] } : { kind: "sum", title, amount: total, rows, note })}
    >
      {display ?? gbp(total)}
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
  if (parts.length === 0) return <span className={`tabular text-faint ${className}`}>{display}</span>;
  return (
    <button type="button" className={`${moneyCls} ${className}`} onClick={() => open({ kind: "parts", title, display, note, parts })}>
      {display}
    </button>
  );
}
