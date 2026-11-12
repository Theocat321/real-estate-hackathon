"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Packet, Property, Sourced } from "@/contracts";
import { PartsMoney, SourcedMoney } from "@/components/SourceDrawer";
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
      <p className="text-slate-600">
        Packet not found in this session. <Link href="/" className="text-accent underline">Start again</Link>.
      </p>
    );
  if (!packet) return <p className="text-slate-500">Loading…</p>;

  const seed = packet.items.find((p) => p.id === packet.seed_id) ?? packet.items[0];
  const others = packet.items.filter((p) => p !== seed);
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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Seed property</p>
        <div className="mt-1 flex flex-wrap items-end gap-x-8 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{seed.address}</h1>
          <Stat label={priceLabel(seed)}>
            <SourcedMoney title={`${priceLabel(seed)} · ${seed.address}`} sourced={seed.price_gbp} />
          </Stat>
          <Stat label="Rent p.a.">
            <SourcedMoney title={`Rent p.a. · ${seed.address}`} sourced={seed.rent_pa_gbp} />
          </Stat>
          <Stat label="Yield">
            <SourcedMoney title={`Yield · ${seed.address}`} sourced={seed.yield_pct} format="pct" />
          </Stat>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {seed.use} · {seed.property_type} · {seed.nation} · {seed.postcode} · {seed.tenure}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-medium">Matched lots ({others.length})</h2>
            <p className="text-sm text-slate-500">{packet.match_reason}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 font-medium">Address</th>
                <th className="font-medium">Use</th>
                <th className="text-right font-medium">Price</th>
                <th className="text-right font-medium">Yield</th>
                <th className="pl-4 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {packet.items.map((p) => (
                <tr key={p.id} className={`border-b border-slate-100 ${p === seed ? "bg-accent-soft/50" : ""}`}>
                  <td className="py-2 pr-2">
                    {p.address}
                    {p === seed && <span className="ml-2 rounded bg-accent px-1.5 text-[10px] text-white">seed</span>}
                  </td>
                  <td className="text-slate-600">
                    {p.use}
                    {p.dwellings > 0 && <span className="text-slate-400"> · {p.dwellings} home{p.dwellings > 1 ? "s" : ""}</span>}
                  </td>
                  <td className="text-right">
                    <SourcedMoney title={`${priceLabel(p)} · ${p.address}`} sourced={p.price_gbp} />
                    {p.price_kind && <span className="ml-1 text-[10px] text-slate-400">{p.price_kind}</span>}
                  </td>
                  <td className="text-right">
                    <SourcedMoney title={`Yield · ${p.address}`} sourced={p.yield_pct} format="pct" />
                  </td>
                  <td className="pl-4">
                    <SourceLink p={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">Packet totals</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Total price">
                <PartsMoney
                  title="Packet total price"
                  display={gbp(packet.totals.price_gbp)}
                  note="Sum of each lot's price as shown in the source data."
                  parts={parts(packet.items, (p) => p.price_gbp)}
                />
              </Row>
              <Row label="Total rent p.a.">
                <PartsMoney
                  title="Packet rent p.a."
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
              <Row label="Dwellings">
                <span className="tabular">{packet.totals.dwellings}</span>
              </Row>
            </dl>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 text-sm">
            <input type="checkbox" checked={sixPlus} onChange={toggleSixHomes} disabled={busy} className="mt-0.5 accent-[#2f5bea]" />
            <span>
              <span className="font-medium">Residential: 6+ homes</span>
              <span className="block text-slate-500">Re-match as a residential packet of at least six dwellings (SDLT then uses non-residential rates).</span>
            </span>
          </label>
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <Link
            href={`/studio/${encodeURIComponent(packet.id)}`}
            className="block rounded-lg bg-accent px-4 py-3 text-center font-medium text-white hover:opacity-90"
          >
            Build structures →
          </Link>
        </aside>
      </div>
    </div>
  );
}

function priceLabel(p: Property): string {
  return { asking: "Asking price", guide: "Guide price", achieved: "Achieved price", hmlr: "Land Registry price" }[p.price_kind ?? "asking"];
}

function parts(items: Property[], pick: (p: Property) => Sourced<number> | null) {
  return items.flatMap((p) => {
    const s = pick(p);
    return s ? [{ label: p.address, sourced: s }] : [];
  });
}

function SourceLink({ p }: { p: Property }) {
  const src = p.price_gbp?.source;
  if (!src) return <span className="text-slate-400">—</span>;
  const text = `${src.file}${src.row != null ? ` · row ${src.row}` : ""}`;
  return src.url ? (
    <a href={src.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline">
      {text}
    </a>
  ) : (
    <span className="font-mono text-xs text-slate-500">{text}</span>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-lg font-medium">{children}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

