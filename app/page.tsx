"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Property } from "@/contracts";
import { SourcedMoney } from "@/components/SourceDrawer";
import { SAMPLE, USE_FIXTURES, extract, match, savePacket, searchProperties } from "@/lib/api";

export default function StartPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extracted, setExtracted] = useState<Property[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function buildFromSeed(seed_id: string) {
    setBusy(`Matching similar properties to ${seed_id}…`);
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

  function trySample() {
    savePacket(SAMPLE.packet);
    router.push(`/packet/${encodeURIComponent(SAMPLE.packet.id)}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Which ownership structure fits this packet?</h1>
      <p className="mt-2 text-slate-600">
        Start from one UK property. We find 4–8 similar ones, draw four ownership structures, and cost each with cited UK tax rules.
      </p>

      <div
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
        className={`mt-8 flex h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition ${
          drag ? "border-accent bg-accent-soft" : "border-slate-300 hover:border-accent hover:bg-slate-50"
        }`}
      >
        <p className="text-lg font-medium">Drop a sale brochure, listings CSV or investor list</p>
        <p className="mt-1 text-sm text-slate-500">PDF or CSV · or click to choose a file</p>
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

      <div className="mt-4 flex items-center gap-3">
        <button onClick={trySample} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Try sample packet
        </button>
        <span className="text-sm text-slate-500">Wireless House + 1 Briar Hill · two real Allsop lots</span>
        {USE_FIXTURES && <span className="ml-auto rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">fixture mode</span>}
      </div>

      {busy && <p className="mt-4 text-sm text-slate-500">{busy}</p>}
      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {extracted.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-slate-500">From your file — pick a seed property</h2>
          <PropertyList properties={extracted} onPick={buildFromSeed} />
        </div>
      )}

      <Search onPick={buildFromSeed} />
    </div>
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
    <div className="mt-10">
      <label className="text-sm font-medium text-slate-500" htmlFor="search">
        Or search the hackathon data
      </label>
      <input
        id="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Address or postcode, e.g. BA3 or Milton Keynes"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-accent"
      />
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <PropertyList properties={results} onPick={onPick} />
    </div>
  );
}

function PropertyList({ properties, onPick }: { properties: Property[]; onPick: (id: string) => void }) {
  if (properties.length === 0) return null;
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
      {properties.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50">
          <button onClick={() => onPick(p.id)} className="flex-1 truncate text-left text-sm hover:text-accent">
            {p.address}
          </button>
          <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{p.use}</span>
          <span className="w-24 text-right text-sm">
            <SourcedMoney title={`Price · ${p.address}`} sourced={p.price_gbp} />
          </span>
          <button onClick={() => onPick(p.id)} className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent">
            Use as seed →
          </button>
        </li>
      ))}
    </ul>
  );
}
