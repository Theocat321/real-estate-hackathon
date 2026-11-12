"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Property } from "@/contracts";
import { SourcedMoney } from "@/components/SourceDrawer";
import { Notice, UseTag } from "@/components/ui";
import { extract, gbp, match, packetFromUpload, savePacket, searchProperties } from "@/lib/api";

export default function StartPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ name: string; properties: Property[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  async function findSimilar(seed_id: string) {
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

  /** Lots with a price typed in by the user, recorded as a user-entered source. */
  function withTypedPrices(items: Property[], file: string): Property[] {
    return items.map((p) => {
      const v = Number((typed[p.id] ?? "").replace(/[£,\s]/g, ""));
      if (p.price_gbp || !v) return p;
      return {
        ...p,
        price_kind: "asking" as const,
        price_gbp: { value: Math.round(v), source: { kind: "user" as const, file, excerpt: `Price entered by you for ${p.address}` } },
      };
    });
  }

  function buildPacket() {
    if (!upload) return;
    const packet = packetFromUpload(withTypedPrices(upload.properties, upload.name), upload.name);
    savePacket(packet);
    router.push(`/packet/${encodeURIComponent(packet.id)}`);
  }

  async function onFile(file: File) {
    setBusy(`Reading ${file.name}…`);
    setError(null);
    setUpload(null);
    setTyped({});
    try {
      const res = await extract(file);
      setWarnings(res.warnings);
      if (res.properties.length === 0) setError(`No properties found in ${file.name}. Upload a listings or auction CSV, or a sale brochure PDF.`);
      else setUpload({ name: file.name, properties: res.properties });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const priced = upload ? withTypedPrices(upload.properties, upload.name) : [];
  const total = priced.reduce((s, p) => s + (p.price_gbp?.value ?? 0), 0);
  const missing = priced.filter((p) => !p.price_gbp).length;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
      <div className="max-w-[640px]">
        <h1 className="wide text-[40px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[52px]">Who should own the building?</h1>
        <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-ink-soft">
          Upload the properties you're buying. Structure Studio draws four ways to hold them, costs each one with the stamp duty,
          ATED and inheritance tax rules it applied, and lists who can set it up.
        </p>

        {!upload && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload a listings CSV or sale brochure"
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
            className={`mt-10 flex cursor-pointer items-center gap-5 rounded-md border bg-sheet px-6 py-9 transition-colors ${
              drag ? "edged border-transparent bg-edge-soft" : "border-rule hover:border-ink"
            }`}
          >
            <UploadGlyph />
            <div>
              <p className="text-[17px] font-semibold">{busy ?? "Upload your properties"}</p>
              <p className="mt-0.5 text-[14px] text-muted">Drop a listings or auction CSV, or a sale brochure PDF. Or click to choose one.</p>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />

        {upload && (
          <section className="edged mt-10 rounded-md bg-sheet p-6">
            <p className="text-[13px] font-medium text-edge">{upload.name}</p>
            <h2 className="wide mt-1 text-[24px] font-bold leading-tight tracking-tight">
              {upload.properties.length} {upload.properties.length === 1 ? "property" : "properties"}, <span className="tabular">{gbp(total)}</span>
            </h2>
            <ul className="mt-4 divide-y divide-rule-soft border-y border-rule-soft">
              {upload.properties.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{p.address}</span>
                    <span className="text-[12px] text-muted">
                      {p.price_gbp?.source.page != null || p.rent_pa_gbp?.source.page != null
                        ? `Brochure${p.rent_pa_gbp ? `, rent ${gbp(p.rent_pa_gbp.value)} a year` : ""}${p.size_sqft ? `, ${p.size_sqft.value.toLocaleString("en-GB")} sq ft` : ""}`
                        : `Row ${p.price_gbp?.source.row ?? i + 1}`}
                    </span>
                  </span>
                  <UseTag use={p.use} />
                  <span className="w-32 text-right text-[14px]">
                    {p.price_gbp ? (
                      <SourcedMoney title={`Price, ${p.address}`} sourced={p.price_gbp} />
                    ) : (
                      <label className="flex items-center justify-end gap-1">
                        <span className="sr-only">Price for {p.address}</span>
                        <span className="text-muted">£</span>
                        <input
                          inputMode="numeric"
                          placeholder="Enter price"
                          value={typed[p.id] ?? ""}
                          onChange={(e) => setTyped((t) => ({ ...t, [p.id]: e.target.value }))}
                          className="tabular w-24 rounded-[3px] border border-edge bg-edge-soft px-2 py-1 text-right text-[14px] outline-none placeholder:text-edge/60 focus:bg-sheet"
                        />
                      </label>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {missing > 0 && (
              <p className="mt-3 text-[13px] text-edge">
                {missing === 1 ? "One property has" : `${missing} properties have`} no price in the file. Enter the price you expect to pay, or it won't be costed.
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button onClick={buildPacket} className="rounded-md bg-ink px-5 py-3 text-[15px] font-semibold text-sheet transition-colors hover:bg-ink-soft">
                Build the packet
              </button>
              <button onClick={() => fileRef.current?.click()} className="text-[14px] font-medium text-muted underline decoration-rule underline-offset-4 hover:text-ink">
                Upload a different file
              </button>
            </div>
          </section>
        )}

        <div className="mt-4 space-y-3" aria-live="polite">
          {busy && upload && <p className="text-[14px] text-muted">{busy}</p>}
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

        <Search onPick={findSimilar} />
      </div>

      <aside className="hidden lg:block lg:pt-2">
        <OwnershipIllustration />
      </aside>
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      <rect x="8" y="4" width="24" height="32" rx="2" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="1.5" />
      <path d="M13 12h14M13 17h14M13 22h9" stroke="var(--color-faint)" strokeWidth="1.5" />
      <rect x="13" y="26" width="9" height="6" fill="none" stroke="var(--color-edge)" strokeWidth="1.5" />
    </svg>
  );
}

/** Generic family-trust chain, drawn as the hero. Illustration only: no figures. */
function OwnershipIllustration() {
  const tiers: { kind: string; label: string; style: string }[][] = [
    [{ kind: "Owner", label: "Family", style: "border border-ink bg-sheet" }],
    [{ kind: "Trust", label: "Discretionary trust", style: "bg-ink text-sheet" }],
    [{ kind: "Company", label: "PropCo Ltd", style: "border border-ink bg-sheet" }],
    [
      { kind: "Property", label: "Lot 1", style: "edged bg-sheet" },
      { kind: "Property", label: "Lot 2", style: "edged bg-sheet" },
      { kind: "Property", label: "Lot 3", style: "edged bg-sheet" },
    ],
  ];
  return (
    <figure className="overflow-hidden rounded-md border border-rule bg-sheet">
      <div className="survey-grid px-6 pb-7 pt-8">
        <div className="flex flex-col items-center">
          {tiers.map((tier, ti) => (
            <div key={ti} className="draw-step flex w-full flex-col items-center" style={{ animationDelay: `${ti * 140}ms` }}>
              {ti > 0 && <span className="h-6 w-px bg-ink" aria-hidden="true" />}
              <div className="flex w-full justify-center gap-3">
                {tier.map((n) => (
                  <div key={n.label} className={`min-w-[112px] rounded-[3px] px-3.5 py-2.5 ${n.style}`}>
                    <p className="text-[11px] opacity-70">{n.kind}</p>
                    <p className="text-[14px] font-semibold leading-tight">{n.label}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="border-t border-rule px-6 py-5 text-[14px] leading-relaxed text-muted">
        One of four ownership chains Studio draws for your packet. Each £ figure opens the rule and source row behind it.
      </figcaption>
    </figure>
  );
}

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
      searchProperties({ q: q.trim(), limit: 8 })
        .then((r) => {
          setResults(r);
          setErr(null);
        })
        .catch((e: Error) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="mt-10 border-t border-rule pt-6">
      <label className="text-[14px] font-semibold" htmlFor="search">
        No file? Start from one property and find similar ones
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
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-rule-soft overflow-hidden rounded-md border border-rule bg-sheet">
          {results.map((p) => (
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
      )}
    </div>
  );
}
