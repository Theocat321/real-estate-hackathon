"use client";

import { useState } from "react";
import type { OptionId, Packet, Property } from "@/contracts";
import type { OptimiseResult, Plan } from "@/engine/optimise";
import { Notice } from "@/components/ui";
import { INVESTOR_PRESETS, gbp, optimisePacket, type InvestorPreset } from "@/lib/api";

const OPTION_NAME: Record<OptionId, string> = {
  A: "Buy directly",
  B: "One UK company",
  C: "Fund over a company",
  D: "Family trust over a company",
};

/** Finds which lots to buy and how to split them into purchases for the lowest tax as a share of price. */
export function OptimisePanel({ packet, onApply }: { packet: Packet; onApply: (items: Property[], plan: OptimiseResult, preset: InvestorPreset) => void }) {
  const [preset, setPreset] = useState<InvestorPreset>("uk_pension");
  const [sameSeller, setSameSeller] = useState(false);
  const [keepAll, setKeepAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<(OptimiseResult & { candidates: Property[] }) | null>(null);

  const homes = packet.items.filter((p) => p.use === "residential").reduce((n, p) => n + Math.max(1, p.dwellings), 0);
  const byId = new Map([...packet.items, ...(res?.candidates ?? [])].map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.address.split(",").slice(0, /^(flat|apartment|unit|lot)\b/i.test(byId.get(id)?.address ?? "") ? 2 : 1).join(",") ?? id;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setRes(await optimisePacket({ packet, investors: INVESTOR_PRESETS[preset], same_seller: sameSeller, keep_all: keepAll }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const saving = res ? res.single.cost - res.best.cost : 0;
  const changedLots = res ? res.added.length > 0 || res.left_out.length > 0 : false;

  return (
    <section className="rounded-md border border-rule bg-sheet p-4 text-[14px]">
      <h2 className="font-semibold">Optimise the packet</h2>
      <p className="mt-0.5 text-[13px] leading-snug text-muted">
        Tries every way to split these lots{keepAll ? "" : " and nearby ones"} into separate purchases, each with its cheapest structure. Counts tax on purchase plus 5 years of yearly charges.
      </p>

      <div className="mt-3 space-y-2 text-[13px]">
        <div className="flex rounded-md border border-rule p-0.5">
          {(Object.keys(INVESTOR_PRESETS) as InvestorPreset[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setPreset(k);
                setRes(null);
              }}
              aria-pressed={preset === k}
              className={`flex-1 rounded-[4px] px-2 py-1 ${preset === k ? "bg-ink font-semibold text-sheet" : "text-muted hover:text-ink"}`}
            >
              {INVESTOR_PRESETS[k][0].label}
            </button>
          ))}
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={sameSeller} onChange={(e) => (setSameSeller(e.target.checked), setRes(null))} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
          <span>
            One seller, one transaction
            <span className="block text-[12px] text-muted">
              Lets six or more homes use non-residential rates{homes > 0 ? ` (this packet has ${homes})` : ""}. Separate auction lots usually aren't.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={!keepAll} onChange={(e) => (setKeepAll(!e.target.checked), setRes(null))} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
          <span>
            Let it swap lots
            <span className="block text-[12px] text-muted">Drop lots or add nearby ones from the data, 4 to 8 in total.</span>
          </span>
        </label>
      </div>

      <button onClick={run} disabled={busy} className="mt-3 w-full rounded-md border border-ink px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-ink hover:text-sheet disabled:opacity-50">
        {busy ? "Pricing every split…" : res ? "Run again" : "Find the best plan"}
      </button>
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {res && (
        <div className="mt-4 border-t border-rule-soft pt-3">
          <p className="text-[12px] text-muted">Best plan</p>
          <p className="wide tabular text-[20px] font-bold leading-tight">
            {gbp(res.best.cost)} <span className="text-[13px] font-normal text-muted">{res.best.rate_pct.toFixed(1)}% of price</span>
          </p>
          <ol className="mt-2 space-y-2">
            {res.best.groups.map((g, i) => (
              <li key={i} className="border-l-[3px] border-ink pl-2.5">
                <p className="text-[13px] font-semibold">
                  {res.best.groups.length > 1 ? `Purchase ${i + 1}: ` : ""}
                  {g.option}, {OPTION_NAME[g.option]}
                  <span className="tabular float-right font-normal">{gbp(g.cost)}</span>
                </p>
                <p className="text-[12px] leading-snug text-muted">{g.item_ids.map(name).join("; ")}</p>
              </li>
            ))}
          </ol>
          <PlanCompare res={res} saving={saving} />
          {res.best.groups.some((g) => g.option === "D") && (
            <p className="mt-2 text-[12px] leading-snug text-review">
              Uses a family trust. Ask an adviser: the trustees' residence decides the 2% surcharge, and the settlor's nil-rate band and past gifts decide the entry charge.
            </p>
          )}
          {res.added.length > 0 && (
            <div className="mt-2 text-[12px]">
              <p className="font-medium">Adds from the data</p>
              {res.added.map((p) => (
                <p key={p.id} className="truncate text-muted">
                  + {p.address}, {gbp(p.price_gbp?.value)} ({p.price_gbp?.source.file}, row {p.price_gbp?.source.row})
                </p>
              ))}
            </div>
          )}
          {res.left_out.length > 0 && (
            <div className="mt-2 text-[12px]">
              <p className="font-medium">Leaves out</p>
              {res.left_out.map((p) => (
                <p key={p.id} className="truncate text-muted">
                  − {p.address}, {gbp(p.price_gbp?.value)}
                </p>
              ))}
            </div>
          )}
          <button
            onClick={() => onApply(res.best.item_ids.map((id) => byId.get(id)!).filter(Boolean), res, preset)}
            className="mt-3 w-full rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-sheet hover:bg-ink-soft"
          >
            {changedLots ? "Use this packet" : "Use this plan"}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-faint">
            Tax only. Set-up and running costs of each structure aren't included, and exit costs are left out because a share sale also saves the next buyer stamp duty.
          </p>
        </div>
      )}
    </section>
  );
}

function PlanCompare({ res, saving }: { res: OptimiseResult; saving: number }) {
  const one = res.single.groups[0];
  return (
    <p className="mt-2 text-[12px] leading-snug text-ink-soft">
      {saving > 0 ? (
        <>
          <span className="font-semibold text-edge">Saves {gbp(saving)}</span> against buying the same lots through one structure ({one.option}, {gbp(res.single.cost)}).
        </>
      ) : (
        <>One structure is already the cheapest way to buy these lots ({one.option}).</>
      )}
      {res.best.item_ids.length !== res.current.item_ids.length || res.added.length > 0 ? (
        <> Today's packet is {rate(res.current)}; this one is {rate(res.best)}.</>
      ) : null}
    </p>
  );
}

const rate = (p: Plan) => `${p.rate_pct.toFixed(1)}% of price`;
