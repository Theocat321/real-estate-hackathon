"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { EngineResult, OptionId, Packet, Structure } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";
import { Notice } from "@/components/ui";
import { INVESTOR_PRESETS, OPTIONS, buildStructures, gbp, loadPacket, runScenario, type InvestorPreset } from "@/lib/api";
import { ROLE_LABEL, adviserBrief, rolesFor, setupSteps, type RoleId } from "@/lib/setup";
import { DIRECTORY } from "@/lib/structurers";

export default function SetupPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Setup />
    </Suspense>
  );
}

function Setup() {
  const { id, option: rawOption } = useParams<{ id: string; option: string }>();
  const search = useSearchParams();
  const option = (OPTIONS.includes(rawOption as OptionId) ? rawOption : "B") as OptionId;
  const preset = (search.get("investor") as InvestorPreset) in INVESTOR_PRESETS ? (search.get("investor") as InvestorPreset) : "uk_pension";
  const investors = INVESTOR_PRESETS[preset];

  const [packet, setPacket] = useState<Packet | null>(null);
  const [structure, setStructure] = useState<Structure | undefined>();
  const [result, setResult] = useState<EngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const p = loadPacket(decodeURIComponent(id));
    if (!p) {
      setError("missing");
      return;
    }
    setPacket(p);
    (async () => {
      try {
        const { structures } = await buildStructures(p, investors);
        setStructure(structures.find((s) => s.option === option));
        setResult(await runScenario({ packet: p, structures, investors }));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // investors derive from preset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, option, preset]);

  const steps = useMemo(() => setupSteps(option, structure, result), [option, structure, result]);
  const roles = rolesFor(option);
  const brief = useMemo(
    () => (packet ? adviserBrief({ option, packet, structure, result, investors, steps }) : ""),
    [option, packet, structure, result, investors, steps],
  );

  if (error === "missing")
    return (
      <div className="max-w-md">
        <h1 className="wide text-[24px] font-bold">This packet isn't in this browser session</h1>
        <Link href="/" className="mt-5 inline-block rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-sheet">
          Pick a property
        </Link>
      </div>
    );
  if (!packet) return <p className="text-muted">Loading…</p>;

  const rows = result?.rows.filter((r) => r.option === option) ?? [];
  const reviewFlags = result?.flags.filter((f) => f.option === option && f.severity === "review") ?? [];

  async function copyBrief() {
    await navigator.clipboard.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="min-w-0">
          <Link href={`/studio/${encodeURIComponent(packet.id)}`} className="text-[13px] text-muted hover:text-ink">
            Back to the comparison
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <span className="wide grid size-10 shrink-0 place-items-center rounded-[3px] bg-ink text-[20px] font-extrabold text-sheet">{option}</span>
            <h1 className="wide text-[28px] font-bold leading-tight tracking-tight">{structure?.name ?? "Loading structure…"}</h1>
          </div>
          <p className="mt-1 text-[14px] text-muted">
            {packet.items.length} lots, {gbp(packet.totals.price_gbp)}, for {investors.map((i) => i.label).join(" and ")}
          </p>
        </div>
        <dl className="ml-auto flex gap-8">
          {(["acquire", "hold", "ten_year"] as const).map((stage) => {
            const r = rows.filter((x) => x.stage === stage);
            if (r.length === 0) return null;
            return (
              <div key={stage}>
                <dt className="text-[12px] text-muted">{{ acquire: "On purchase", hold: "Each year", ten_year: "Every 10 years" }[stage]}</dt>
                <dd className="wide tabular text-[22px] font-bold">
                  <CostMoney title={`Option ${option}, ${stage}`} rows={r} />
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section>
          <h2 className="wide text-[20px] font-bold tracking-tight">Steps to put it in place</h2>
          <ol className="mt-4 rounded-md border border-rule bg-sheet">
            {steps.map((s, i) => (
              <li key={s.id} className="flex gap-4 border-b border-rule-soft px-5 py-4 last:border-0">
                <span className="tabular mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-ink text-[13px] font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-[15px] font-semibold">{s.title}</h3>
                    {s.deadline && <span className="rounded-full bg-edge-soft px-2 py-0.5 text-[12px] font-medium text-edge">{s.deadline}</span>}
                  </div>
                  <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-soft">{s.detail}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    {s.roles.map((r) => (
                      <a key={r} href={`#role-${r}`} className="rounded-full bg-paper px-2 py-0.5 font-medium text-ink-soft hover:bg-sage-soft">
                        {ROLE_LABEL[r]}
                      </a>
                    ))}
                    {s.source && (
                      <a href={s.source.url} target="_blank" rel="noreferrer" className="text-muted underline decoration-rule underline-offset-2 hover:text-ink">
                        {s.source.label}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {reviewFlags.length > 0 && (
            <div className="mt-6">
              <h3 className="text-[14px] font-semibold">Ask your advisers about</h3>
              <ul className="mt-2 space-y-2">
                {reviewFlags.map((f, i) => (
                  <li key={i}>
                    <Notice tone="review">{f.message}</Notice>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="wide text-[20px] font-bold tracking-tight">Who you need</h2>
            {DIRECTORY && <p className="mt-1 text-[12px] text-muted">{DIRECTORY.note}</p>}
            <ul className="mt-4 space-y-4">
              {roles.map((r) => (
                <RoleBlock key={r} role={r} option={option} />
              ))}
            </ul>
          </section>

          <section className="rounded-md bg-ink p-5 text-sheet">
            <h2 className="text-[15px] font-semibold">Brief for your advisers</h2>
            <p className="mt-1 text-[13px] text-sheet/70">
              The packet, structure, estimated costs, steps and open questions, ready to paste into an email.
            </p>
            <pre className="narrow mt-3 font-sans max-h-56 overflow-auto whitespace-pre-wrap rounded-[3px] bg-sheet/10 p-3 text-[12px] leading-relaxed text-sheet/90">
              {brief}
            </pre>
            <div className="mt-3 flex gap-2">
              <button onClick={copyBrief} className="rounded-md bg-sheet px-4 py-2 text-[13px] font-semibold text-ink hover:bg-paper">
                {copied ? "Copied" : "Copy brief"}
              </button>
              <a
                href={`mailto:?subject=${encodeURIComponent(brief.split("\n")[0].replace("Subject: ", ""))}&body=${encodeURIComponent(brief.split("\n").slice(2).join("\n"))}`}
                className="rounded-md border border-sheet/40 px-4 py-2 text-[13px] font-semibold hover:bg-sheet/10"
              >
                Open in email
              </a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function RoleBlock({ role, option }: { role: RoleId; option: OptionId }) {
  const info = DIRECTORY?.roles[role];
  const firms = DIRECTORY?.firms.filter((f) => f.roles.includes(role) && f.options.includes(option)) ?? [];
  const registers = DIRECTORY?.registers.filter((r) => r.roles.includes(role)) ?? [];
  return (
    <li id={`role-${role}`} className="scroll-mt-6 rounded-md border border-rule bg-sheet p-4">
      <h3 className="text-[15px] font-semibold">{info?.label ?? ROLE_LABEL[role]}</h3>
      {info?.why && <p className="mt-0.5 text-[13px] leading-snug text-muted">{info.why}</p>}
      {firms.length > 0 && (
        <ul className="mt-3 divide-y divide-rule-soft">
          {firms.map((f) => (
            <li key={f.name} className="py-2">
              <div className="flex items-baseline justify-between gap-2">
                <a href={f.url} target="_blank" rel="noreferrer" className="text-[14px] font-semibold underline decoration-rule underline-offset-4 hover:decoration-ink">
                  {f.name}
                </a>
                <span className="shrink-0 text-[11px] text-muted">{f.jurisdiction}</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{f.summary}</p>
            </li>
          ))}
        </ul>
      )}
      {registers.length > 0 && (
        <div className="mt-3 border-t border-rule-soft pt-2">
          <p className="text-[12px] font-medium text-muted">Find and check more</p>
          <ul className="mt-1 space-y-1">
            {registers.map((r) => (
              <li key={r.name} className="text-[12px] leading-snug">
                <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline decoration-rule underline-offset-2 hover:decoration-ink">
                  {r.name}
                </a>
                <span className="text-muted">. {r.how}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!DIRECTORY && <p className="mt-2 text-[12px] text-faint">Firm list loading from research.</p>}
    </li>
  );
}
