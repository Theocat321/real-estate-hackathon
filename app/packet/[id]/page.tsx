"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Packet, Property, Sourced } from "@/contracts";
import { PartsMoney, SourcedMoney } from "@/components/SourceDrawer";
import { Figure, Notice, UseTag } from "@/components/ui";
import { gbp, loadPacket, match, savePacket } from "@/lib/api";

export default function PacketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = loadPacket(decodeURIComponent(id));
    if (p) setPacket(p);
    else setMissing(true);
  }, [id]);

  if (missing)
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
  const sixPlus = packet.totals.dwellings >= 6 && packet.items.every((p) => p.use === "residential");

  async function toggleSixHomes() {
    if (!packet) return;
    setBusy(true);
    setError(null);
    try {
      const next = await match(sixPlus ? { seed_id: packet.seed_id, n: 5 } : { seed_id: packet.seed_id, use: "residential", min_dwellings: 6 });
      savePacket(next);
      router.replace(`/packet/${encodeURIComponent(next.id)}`);
      setPacket(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const facts: [string, string][] = [
    ["Use", cap(seed.use)],
    ["Type", seed.property_type === "unknown" ? "Not stated" : cap(seed.property_type)],
    ["Postcode", seed.postcode],
    ["Nation", NATION[seed.nation]],
    ["Tenure", seed.tenure === "unknown" ? "Not stated" : cap(seed.tenure)],
  ];

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-10">
        <section className="edged rounded-md bg-sheet p-7">
          <p className="text-[13px] font-medium text-edge">Starting property</p>
          <h1 className="wide mt-1 max-w-[34ch] text-[28px] font-bold leading-[1.1] tracking-tight">{seed.address}</h1>
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-x-12 gap-y-4 border-t border-rule-soft pt-5">
            <Figure label={priceLabel(seed)} big>
              <SourcedMoney title={`${priceLabel(seed)}, ${seed.address}`} sourced={seed.price_gbp} />
            </Figure>
            <Figure label="Rent a year" big>
              <SourcedMoney title={`Rent a year, ${seed.address}`} sourced={seed.rent_pa_gbp} />
            </Figure>
            <Figure label="Yield" big>
              <SourcedMoney title={`Yield, ${seed.address}`} sourced={seed.yield_pct} format="pct" />
            </Figure>
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 className="wide text-[20px] font-bold tracking-tight">
              {packet.items.length} lots in this packet
            </h2>
          </div>
          <p className="mt-1 max-w-[70ch] text-[14px] text-muted">{packet.match_reason}</p>

          <div className="mt-4 overflow-x-auto rounded-md border border-rule bg-sheet">
            <table className="w-full min-w-[720px] text-[14px]">
              <thead>
                <tr className="border-b border-rule text-left text-[12px] text-muted">
                  <th className="px-4 py-2.5 font-medium">Property</th>
                  <th className="px-2 font-medium">Use</th>
                  <th className="px-2 text-right font-medium">Price</th>
                  <th className="px-2 text-right font-medium">Yield</th>
                  <th className="px-4 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {packet.items.map((p) => {
                  const isSeed = p === seed;
                  return (
                    <tr key={p.id} className="border-b border-rule-soft last:border-0">
                      <td className={`py-3 pl-4 pr-2 ${isSeed ? "border-l-[3px] border-edge pl-[13px]" : ""}`}>
                        <span className="font-medium">{p.address}</span>
                        {isSeed && <span className="block text-[12px] font-medium text-edge">Starting property</span>}
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-2">
                          <UseTag use={p.use} />
                          {p.dwellings > 0 && (
                            <span className="text-[12px] text-muted">
                              {p.dwellings} home{p.dwellings > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 text-right">
                        <SourcedMoney title={`${priceLabel(p)}, ${p.address}`} sourced={p.price_gbp} />
                        {p.price_kind && <span className="ml-1.5 text-[11px] text-muted">{p.price_kind}</span>}
                      </td>
                      <td className="px-2 text-right">
                        <SourcedMoney title={`Yield, ${p.address}`} sourced={p.yield_pct} format="pct" />
                      </td>
                      <td className="whitespace-nowrap px-4">
                        <SourceLink p={p} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-md border border-rule bg-sheet p-6">
          <h2 className="text-[13px] font-medium text-muted">Packet total</h2>
          <p className="wide tabular mt-1 text-[34px] font-extrabold leading-none tracking-tight">
            <PartsMoney
              title="Packet total price"
              display={gbp(packet.totals.price_gbp)}
              note="Sum of each lot's price as shown in the source data."
              parts={parts(packet.items, (p) => p.price_gbp)}
            />
          </p>
          <dl className="mt-5 space-y-2.5 border-t border-rule-soft pt-4 text-[14px]">
            <Row label="Rent a year">
              <PartsMoney
                title="Packet rent a year"
                display={gbp(packet.totals.rent_pa_gbp)}
                note="Sum of passing rent where the source data states it."
                parts={parts(packet.items, (p) => p.rent_pa_gbp)}
              />
            </Row>
            <Row label="Blended yield">
              <PartsMoney
                title="Blended yield"
                display={packet.totals.blended_yield_pct == null ? "—" : `${packet.totals.blended_yield_pct.toFixed(2)}%`}
                note="Total rent ÷ total price × 100, using only lots where both are known."
                parts={[...parts(packet.items, (p) => p.rent_pa_gbp), ...parts(packet.items, (p) => p.price_gbp)]}
              />
            </Row>
            <Row label="Homes">
              <span className="tabular">{packet.totals.dwellings}</span>
            </Row>
          </dl>
        </section>

        <label className={`flex cursor-pointer items-start gap-3 rounded-md border bg-sheet p-4 text-[14px] ${sixPlus ? "border-ink" : "border-rule"}`}>
          <input type="checkbox" checked={sixPlus} onChange={toggleSixHomes} disabled={busy} className="mt-1 size-4 accent-[var(--color-ink)]" />
          <span>
            <span className="font-semibold">Rebuild as six or more homes</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-muted">
              Re-match as a residential packet of at least six dwellings. Stamp duty then uses non-residential rates.
            </span>
            {busy && <span className="mt-1 block text-[12px] text-muted">Re-matching…</span>}
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}

        <Link
          href={`/studio/${encodeURIComponent(packet.id)}`}
          className="block rounded-md bg-ink px-4 py-3.5 text-center text-[15px] font-semibold text-sheet transition-colors hover:bg-ink-soft"
        >
          Compare four structures
        </Link>
      </aside>
    </div>
  );
}

const NATION = { england: "England", wales: "Wales", scotland: "Scotland", ni: "Northern Ireland" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function priceLabel(p: Property): string {
  return { asking: "Asking price", guide: "Guide price", achieved: "Sold for", hmlr: "Land Registry price" }[p.price_kind ?? "asking"];
}

function parts(items: Property[], pick: (p: Property) => Sourced<number> | null) {
  return items.flatMap((p) => {
    const s = pick(p);
    return s ? [{ label: p.address, sourced: s }] : [];
  });
}

function SourceLink({ p }: { p: Property }) {
  const src = p.price_gbp?.source;
  if (!src) return <span className="text-faint">—</span>;
  const text = `${src.file}${src.row != null ? `, row ${src.row}` : ""}`;
  return src.url ? (
    <a href={src.url} target="_blank" rel="noreferrer" className="narrow text-[13px] text-ink-soft underline decoration-rule underline-offset-4 hover:decoration-ink">
      {text}
    </a>
  ) : (
    <span className="narrow text-[13px] text-muted">{text}</span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
