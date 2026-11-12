"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Packet, Property, Sourced } from "@/contracts";
import { PartsMoney, SourcedMoney } from "@/components/SourceDrawer";
import { Figure, UseTag } from "@/components/ui";
import { INVESTOR_PRESETS, baseOf, gbp, loadPacket, setLotRent, type InvestorPreset } from "@/lib/api";
import { DEFAULT_GROSS_YIELD_PCT, rentFor } from "@/engine/rules/rent";

export default function PacketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [missing, setMissing] = useState(false);
  const [preset, setPreset] = useState<InvestorPreset>("uk_pension");

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
  const base = baseOf(packet.id);
  const homesRes = packet.items.filter((p) => p.use === "residential").reduce((n, p) => n + Math.max(1, p.dwellings), 0);
  const anyYield = packet.items.some((p) => p.yield_pct);
  const rentOf = (p: Property) => (p.price_gbp ? rentFor(p, p.price_gbp.value) : null);
  const estimated = packet.items.filter((p) => rentOf(p)?.estimated);
  const rentTotal = packet.items.reduce((s, p) => s + (rentOf(p)?.value ?? 0), 0);
  const homesMixed = packet.items.filter((p) => p.use === "mixed").reduce((n, p) => n + p.dwellings, 0);

  function removeAdded() {
    const prev = base ? loadPacket(base) : null;
    if (!prev) return;
    setPacket(prev);
    router.replace(`/packet/${encodeURIComponent(prev.id)}`);
  }

  const facts: [string, string][] = [
    ["Use", cap(seed.use)],
    ["Type", seed.property_type === "unknown" ? "Not stated" : cap(seed.property_type)],
    ["Postcode", seed.postcode],
    ["Nation", NATION[seed.nation]],
    ["Tenure", seed.tenure === "unknown" ? "Not stated" : cap(seed.tenure)],
  ];

  return (
    <div className="mx-auto grid max-w-[1400px] gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
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
            {seed.rent_pa_gbp && (
              <Figure label="Rent a year" big>
                <SourcedMoney title={`Rent a year, ${seed.address}`} sourced={seed.rent_pa_gbp} />
              </Figure>
            )}
            {seed.yield_pct && (
              <Figure label="Yield" big>
                <SourcedMoney title={`Yield, ${seed.address}`} sourced={seed.yield_pct} format="pct" />
              </Figure>
            )}
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
                  {anyYield && <th className="px-2 text-right font-medium">Yield</th>}
                  <th className="px-2 text-right font-medium">Rent a year</th>
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
                      {anyYield && (
                        <td className="px-2 text-right">
                          <SourcedMoney title={`Yield, ${p.address}`} sourced={p.yield_pct} format="pct" />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-2 text-right">
                        <RentCell p={p} estimate={rentOf(p)} onSet={(v) => setPacket(setLotRent(packet, p.id, v))} />
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
          {estimated.length > 0 && (
            <p className="mt-2 text-[13px] text-edge">
              {estimated.length === packet.items.length ? "No lot has" : `${estimated.length} of ${packet.items.length} lots have no`} rent in the data, so the tax on rent uses a
              typical gross yield ({DEFAULT_GROSS_YIELD_PCT.residential}% residential, {DEFAULT_GROSS_YIELD_PCT.commercial}% commercial). Type the real rent to replace it.
            </p>
          )}
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
          <p className="mt-2 text-[13px] text-muted">{mix(packet.items)}</p>
          {(homesRes > 0 || homesMixed > 0 || rentTotal > 0) && (
            <dl className="mt-4 space-y-2 border-t border-rule-soft pt-3 text-[14px]">
              {(homesRes > 0 || homesMixed > 0) && (
                <Row label="Homes">
                  <span className="tabular">
                    {homesRes}
                    {homesMixed > 0 && <span className="font-normal text-muted"> + {homesMixed} in mixed use</span>}
                  </span>
                </Row>
              )}
              {rentTotal > 0 && (
                <Row label={estimated.length > 0 ? `Rent a year, ${estimated.length} estimated` : "Rent a year"}>
                  <PartsMoney
                    title="Packet rent a year"
                    display={gbp(rentTotal)}
                    note="Stated or entered rent, else the price times a typical gross yield (marked estimated)."
                    parts={packet.items.flatMap((p) => {
                      const r = rentOf(p);
                      return r ? [{ label: `${p.address}${r.estimated ? " (estimated)" : ""}`, sourced: { value: r.value, source: r.source } }] : [];
                    })}
                  />
                </Row>
              )}
              {packet.totals.blended_yield_pct != null && (
                <Row label="Blended yield">
                  <PartsMoney
                    title="Blended yield"
                    display={`${packet.totals.blended_yield_pct.toFixed(2)}%`}
                    note="Total rent ÷ total price × 100, using only lots where both are known."
                    parts={[...parts(packet.items, (p) => p.rent_pa_gbp), ...parts(packet.items, (p) => p.price_gbp)]}
                  />
                </Row>
              )}
            </dl>
          )}
        </section>

        <section className="rounded-md border border-rule bg-sheet p-6">
          <h2 className="text-[13px] font-medium text-muted">Who is investing</h2>
          <div className="mt-2 flex rounded-md border border-rule p-0.5 text-[13px]">
            {(Object.keys(INVESTOR_PRESETS) as InvestorPreset[]).map((k) => (
              <button
                key={k}
                onClick={() => setPreset(k)}
                aria-pressed={preset === k}
                className={`flex-1 rounded-[4px] px-2 py-1.5 transition-colors ${preset === k ? "bg-ink font-semibold text-sheet" : "text-muted hover:text-ink"}`}
              >
                {INVESTOR_PRESETS[k][0].label}
              </button>
            ))}
          </div>
          <Link
            href={`/studio/${encodeURIComponent(packet.id)}?investor=${preset}`}
            className="mt-4 block rounded-md bg-ink px-4 py-3.5 text-center text-[15px] font-semibold text-sheet transition-colors hover:bg-ink-soft"
          >
            Find the best structure
          </Link>
        </section>

        {base && (
          <button onClick={removeAdded} className="text-[13px] font-medium text-muted underline decoration-rule underline-offset-2 hover:text-ink">
            Back to the original packet
          </button>
        )}
      </aside>
    </div>
  );
}

const NATION = { england: "England", wales: "Wales", scotland: "Scotland", ni: "Northern Ireland" } as const;
/** "2 residential, 1 commercial, 1 mixed use" */
function mix(items: Property[]): string {
  const n = { residential: 0, commercial: 0, mixed: 0 };
  for (const p of items) n[p.use]++;
  return (
    [n.residential && `${n.residential} residential`, n.commercial && `${n.commercial} commercial`, n.mixed && `${n.mixed} mixed use`]
      .filter(Boolean)
      .join(", ") + ` ${items.length === 1 ? "lot" : "lots"}`
  );
}

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

/** Stated rent (from the data), or a box to type it, showing the estimate until then. */
function RentCell({ p, estimate, onSet }: { p: Property; estimate: ReturnType<typeof rentFor> | null; onSet: (v: number | null) => void }) {
  const entered = p.rent_pa_gbp?.source.kind === "user";
  const [text, setText] = useState(entered ? String(p.rent_pa_gbp!.value) : "");
  if (!estimate) return <span className="text-faint">—</span>;
  if (p.rent_pa_gbp && !entered) return <SourcedMoney title={`Rent a year, ${p.address}`} sourced={p.rent_pa_gbp} />;
  if (p.yield_pct && !entered) return <span className="tabular" title="Price x stated yield">{gbp(estimate.value)}</span>;
  const commit = () => {
    const v = Number(text.replace(/[£,\s]/g, ""));
    onSet(text.trim() && v > 0 ? v : null);
  };
  return (
    <label className="inline-flex items-center justify-end gap-1">
      <span className="sr-only">Rent a year for {p.address}</span>
      <span className="text-muted">£</span>
      <input
        inputMode="numeric"
        placeholder={`${estimate.value.toLocaleString("en-GB")} est.`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={`tabular w-28 rounded-[3px] border px-2 py-1 text-right text-[14px] outline-none focus:bg-sheet ${
          entered ? "border-rule bg-sheet" : "border-edge bg-edge-soft placeholder:text-edge/70"
        }`}
      />
    </label>
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
