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

  const stageCost = (stage: "acquire" | "hold" | "ten_year") => rows.filter((x) => x.stage === stage);
  const mailto = `mailto:?subject=${encodeURIComponent(brief.split("\n")[0].replace("Subject: ", ""))}&body=${encodeURIComponent(brief.split("\n").slice(2).join("\n"))}`;
  const deadlines = steps.filter((s) => s.deadline).length;

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href={`/studio/${encodeURIComponent(packet.id)}`} className="text-[13px] text-muted hover:text-ink">
        Back to the comparison
      </Link>

      {/* What you're setting up, what it costs, one place to act */}
      <header className="mt-2 rounded-md bg-sheet p-6 shadow-[0_1px_0_var(--color-rule)]">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="wide grid size-11 shrink-0 place-items-center rounded-[3px] bg-ink text-[22px] font-extrabold text-sheet">{option}</span>
            <div className="min-w-0">
              <h1 className="wide text-[26px] font-bold leading-tight tracking-tight">{structure?.name ?? "Loading structure…"}</h1>
              <p className="mt-1 text-[14px] text-muted">
                {packet.items.length} lots, {gbp(packet.totals.price_gbp)}, for {investors.map((i) => i.label).join(" and ")}
              </p>
            </div>
          </div>
          <dl className="flex gap-8">
            {(["acquire", "hold", "ten_year"] as const).map((stage) => {
              const r = stageCost(stage);
              if (r.length === 0) return null;
              return (
                <div key={stage}>
                  <dt className="text-[12px] text-muted">{{ acquire: "Tax on purchase", hold: "Each year", ten_year: "Every 10 years" }[stage]}</dt>
                  <dd className="wide tabular text-[24px] font-bold leading-tight">
                    <CostMoney title={`Option ${option}, ${stage}`} rows={r} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
          <p className="mr-auto text-[14px] text-ink-soft">
            <span className="font-semibold text-ink">{steps.length} steps</span>, {roles.length} kinds of adviser
            {deadlines > 0 && <>, {deadlines} legal deadline{deadlines > 1 ? "s" : ""}</>}.
          </p>
          <button onClick={copyBrief} className="rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-sheet hover:bg-ink-soft">
            {copied ? "Copied" : "Copy brief for advisers"}
          </button>
          <a href={mailto} className="rounded-md border border-ink px-4 py-2.5 text-[14px] font-semibold hover:bg-ink hover:text-sheet">
            Email it
          </a>
        </div>
        <details className="group mt-3">
          <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">Preview the brief</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-paper p-4 font-sans text-[13px] leading-relaxed text-ink-soft">{brief}</pre>
        </details>
      </header>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* What to do, in order */}
        <section>
          <h2 className="text-[15px] font-semibold">What to do</h2>
          <ol className="mt-3 space-y-px overflow-hidden rounded-md border border-rule bg-rule">
            {steps.map((s, i) => (
              <li key={s.id} className="flex gap-4 bg-sheet px-5 py-3.5">
                <span className="tabular mt-px grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-sheet">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-[15px] font-semibold leading-snug">{s.title}</h3>
                    {s.deadline && <span className="rounded-full bg-edge-soft px-2 py-0.5 text-[12px] font-medium text-edge">{s.deadline}</span>}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted">
                    {s.detail}{" "}
                    {s.source && (
                      <a href={s.source.url} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:text-ink">
                        gov.uk
                      </a>
                    )}
                  </p>
                </div>
                <span className="hidden shrink-0 text-right text-[12px] leading-snug text-ink-soft sm:block sm:w-36">
                  {s.roles.map((r) => (
                    <a key={r} href={`#role-${r}`} className="block hover:text-ink hover:underline">
                      {ROLE_LABEL[r]}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ol>

          {reviewFlags.length > 0 && (
            <details className="mt-5 rounded-md border border-review/30 bg-review-soft px-4 py-3">
              <summary className="cursor-pointer text-[14px] font-semibold text-review">
                {reviewFlags.length} point{reviewFlags.length > 1 ? "s" : ""} to raise with your adviser
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-snug text-review">
                {reviewFlags.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* Who to call */}
        <aside>
          <h2 className="text-[15px] font-semibold">Who to call</h2>
          <ul className="mt-3 space-y-px overflow-hidden rounded-md border border-rule bg-rule">
            {roles.map((r) => (
              <RoleBlock key={r} role={r} option={option} fundJurisdiction={structure?.nodes.find((n) => n.kind === "fund")?.jurisdiction} />
            ))}
          </ul>
          {DIRECTORY && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">Check a firm on the official registers</summary>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {DIRECTORY.registers
                  .filter((reg) => reg.roles.some((x) => roles.includes(x)))
                  .map((reg) => (
                    <li key={reg.name}>
                      <a href={reg.url} target="_blank" rel="noreferrer" className="font-medium underline decoration-rule underline-offset-2 hover:decoration-ink">
                        {reg.name}
                      </a>
                    </li>
                  ))}
              </ul>
              <p className="mt-2 text-[12px] text-faint">{DIRECTORY.note}</p>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}

const FUND_ROLES: RoleId[] = ["fund_lawyer", "fund_admin"];

/** One recommended firm per role; the rest behind a toggle. */
function RoleBlock({ role, option, fundJurisdiction }: { role: RoleId; option: OptionId; fundJurisdiction?: string }) {
  const [all, setAll] = useState(false);
  const firms =
    DIRECTORY?.firms.filter(
      (f) => f.roles.includes(role) && f.options.includes(option) && (!FUND_ROLES.includes(role) || !fundJurisdiction || f.jurisdiction === fundJurisdiction),
    ) ?? [];
  const shown = all ? firms : firms.slice(0, 1);
  return (
    <li id={`role-${role}`} className="scroll-mt-6 bg-sheet px-4 py-3">
      <p className="text-[12px] text-muted">{ROLE_LABEL[role]}</p>
      {shown.length === 0 && <p className="text-[13px] text-faint">Use the registers below to find one.</p>}
      {shown.map((f) => (
        <div key={f.name} className="mt-1">
          <div className="flex items-baseline justify-between gap-2">
            <a href={f.url} target="_blank" rel="noreferrer" className="text-[15px] font-semibold underline decoration-rule underline-offset-4 hover:decoration-ink">
              {f.name}
            </a>
            <span className="shrink-0 text-[11px] text-faint">{f.jurisdiction}</span>
          </div>
          {all && <p className="text-[12px] leading-snug text-muted">{f.summary}</p>}
        </div>
      ))}
      {firms.length > 1 && (
        <button onClick={() => setAll((v) => !v)} className="mt-1 text-[12px] font-medium text-muted underline decoration-rule underline-offset-2 hover:text-ink">
          {all ? "Show one" : `${firms.length - 1} more`}
        </button>
      )}
    </li>
  );
}
