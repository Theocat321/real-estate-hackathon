"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Property } from "@/contracts";
import { SourcedMoney } from "@/components/SourceDrawer";
import { Notice, UseTag } from "@/components/ui";
import { RESIDENTIAL_SAMPLE, SAMPLE, USE_FIXTURES, extract, gbp, match, savePacket, searchProperties } from "@/lib/api";

export default function StartPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extracted, setExtracted] = useState<Property[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function buildFromSeed(seed_id: string) {
    setBusy("Finding similar properties…");
    setError(null);
    try {
      const packet = await match({ seed_id, n: 5 });
      savePacket(packet);
      router.push(`/packet/${encodeURIComponent(packet.id)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    setBusy(`Reading ${file.name}…`);
    setError(null);
    try {
      const res = await extract(file);
      setExtracted(res.properties);
      setWarnings(res.warnings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function trySample(id: string = SAMPLE.packet.id) {
    router.push(`/packet/${encodeURIComponent(id)}`);
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
      <div className="max-w-[640px]">
        <h1 className="wide text-[40px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
          Who should own the building?
        </h1>
        <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-ink-soft">
          Start from one UK property. Structure Studio finds similar lots, draws four ways to hold them, and costs each one
          with the stamp duty, ATED and inheritance tax rules it applied, linked to the source.
        </p>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a brochure, listings CSV or investor list"
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void onFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={`mt-10 flex cursor-pointer items-center gap-5 rounded-md border bg-sheet px-6 py-7 transition-colors ${
            drag ? "edged border-transparent bg-edge-soft" : "border-rule hover:border-ink"
          }`}
        >
          <UploadGlyph />
          <div>
            <p className="text-[16px] font-semibold">Upload a sale brochure, listings CSV or investor list</p>
            <p className="mt-0.5 text-[14px] text-muted">Drop a PDF or CSV here, or click to choose one.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </div>

        <Search onPick={buildFromSeed} />

        <div className="mt-4 space-y-3" aria-live="polite">
          {busy && <p className="text-[14px] text-muted">{busy}</p>}
          {error && <Notice tone="error">{error}</Notice>}
          {warnings.length > 0 && (
            <Notice tone="review">
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>

        {extracted.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[14px] font-semibold">Found in your file. Pick the property to start from.</h2>
            <PropertyList properties={extracted} onPick={buildFromSeed} />
          </section>
        )}
      </div>

      <aside className="lg:pt-2">
        <SampleDiagram onOpen={() => trySample()} onOpenResidential={() => trySample(RESIDENTIAL_SAMPLE.id)} />
        {USE_FIXTURES && (
          <p className="mt-3 text-[12px] text-faint">Running on saved fixtures. Set NEXT_PUBLIC_USE_FIXTURES=false to use live data.</p>
        )}
      </aside>
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      <rect x="8" y="4" width="24" height="32" rx="2" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="1.5" />
      <path d="M13 12h14M13 17h14M13 22h9" stroke="var(--color-faint)" strokeWidth="1.5" />
      <rect x="13" y="26" width="9" height="6" fill="none" stroke="var(--color-edge)" strokeWidth="1.5" />
    </svg>
  );
}

/** The sample packet's family-trust structure, drawn as the hero. */
function SampleDiagram({ onOpen, onOpenResidential }: { onOpen: () => void; onOpenResidential: () => void }) {
  const d = SAMPLE.structures.find((s) => s.option === "D");
  const nodes = d?.nodes ?? [];
  const tiers = [
    nodes.filter((n) => n.kind === "investor"),
    nodes.filter((n) => n.kind === "trust" || n.kind === "fund"),
    nodes.filter((n) => n.kind === "company"),
    nodes.filter((n) => n.kind === "property"),
  ].filter((t) => t.length > 0);
  const priceOf = (propertyId?: string) => SAMPLE.packet.items.find((p) => p.id === propertyId)?.price_gbp?.value;

  return (
    <figure className="overflow-hidden rounded-md border border-rule bg-sheet">
      <div className="survey-grid px-6 pb-6 pt-7">
        <div className="flex flex-col items-center">
          {tiers.map((tier, ti) => (
            <div key={ti} className="draw-step flex w-full flex-col items-center" style={{ animationDelay: `${ti * 140}ms` }}>
              {ti > 0 && <span className="h-6 w-px bg-ink" aria-hidden="true" />}
              <div className="flex w-full justify-center gap-3">
                {tier.map((n) => {
                  const isProp = n.kind === "property";
                  const price = isProp ? priceOf(n.property_id) : undefined;
                  return (
                    <div
                      key={n.id}
                      className={`min-w-[140px] rounded-[3px] px-3.5 py-2.5 ${
                        isProp ? "edged bg-sheet" : n.kind === "trust" ? "bg-ink text-sheet" : "border border-ink bg-sheet"
                      }`}
                    >
                      <p className="text-[11px] text-current opacity-70">{KIND_NAME[n.kind]}</p>
                      <p className="text-[14px] font-semibold leading-tight">{n.label}</p>
                      {price != null && <p className="tabular mt-0.5 text-[13px] text-edge">{gbp(price)}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="border-t border-rule px-6 py-5">
        <p className="text-[15px] font-semibold">Sample: two Allsop auction lots, held through a family trust</p>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">
          One of four structures Studio compares for this packet. Each £ figure opens the rule and source row behind it.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onOpen}
            className="rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-sheet transition-colors hover:bg-ink-soft"
          >
            Open the sample packet
          </button>
          <button
            onClick={onOpenResidential}
            className="rounded-md border border-ink px-4 py-2.5 text-[14px] font-semibold transition-colors hover:bg-ink hover:text-sheet"
          >
            Try five residential lots
          </button>
        </div>
      </figcaption>
    </figure>
  );
}

const KIND_NAME: Record<string, string> = {
  investor: "Owner",
  trust: "Trust",
  fund: "Fund",
  company: "Company",
  property: "Property",
};

function Search({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Property[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchProperties({ q: q.trim(), limit: 10 })
        .then((r) => {
          setResults(r);
          setErr(null);
        })
        .catch((e: Error) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="mt-8">
      <label className="text-[14px] font-semibold" htmlFor="search">
        Or search 9,426 listings and auction results
      </label>
      <div className="relative mt-2">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" />
          <path d="m11 11 3.5 3.5" stroke="var(--color-muted)" strokeWidth="1.5" />
        </svg>
        <input
          id="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Address or postcode, like BA3 or Milton Keynes"
          className="w-full rounded-md border border-rule bg-sheet py-3 pl-10 pr-3 text-[15px] outline-none placeholder:text-faint focus:border-ink"
        />
      </div>
      {err && (
        <div className="mt-2">
          <Notice tone="error">{err}</Notice>
        </div>
      )}
      {q.trim().length >= 2 && results.length === 0 && !err && <p className="mt-2 text-[13px] text-muted">No matches yet. Try a postcode area.</p>}
      <PropertyList properties={results} onPick={onPick} />
    </div>
  );
}

function PropertyList({ properties, onPick }: { properties: Property[]; onPick: (id: string) => void }) {
  if (properties.length === 0) return null;
  return (
    <ul className="mt-2 divide-y divide-rule-soft overflow-hidden rounded-md border border-rule bg-sheet">
      {properties.map((p) => (
        <li key={p.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-paper">
          <button onClick={() => onPick(p.id)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[14px] font-medium">{p.address}</span>
            <span className="text-[12px] text-muted">{p.property_type !== "unknown" ? p.property_type : p.use}</span>
          </button>
          <UseTag use={p.use} />
          <span className="w-28 text-right text-[14px]">
            <SourcedMoney title={`Price, ${p.address}`} sourced={p.price_gbp} />
          </span>
          <button
            onClick={() => onPick(p.id)}
            className="rounded-md border border-ink px-2.5 py-1 text-[12px] font-semibold opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            Start here
          </button>
        </li>
      ))}
    </ul>
  );
}
