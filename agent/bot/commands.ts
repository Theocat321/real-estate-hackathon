/**
 * Grok Bot commands for Structure Studio.
 *
 *   "build packet from <property id or address>"  -> /api/properties? -> /api/match -> /api/structures -> /api/engine
 *   "explain option <A-D>"                         -> plain English from EngineResult rows (Grok writes prose, never numbers it wasn't given)
 *
 * Every £ figure in a reply is quoted from EngineResult / Packet. Nothing is computed here.
 */
import { z } from "zod";
import type { EngineResult, Investor, MatchRequest, OptionId, Packet, Property, Stage, Structure } from "@/contracts";
import { grokJson, type Transport } from "../grok";

export type Command = { kind: "build"; target: string } | { kind: "explain"; option: OptionId } | { kind: "help" };

export function parseCommand(text: string): Command {
  const t = text.trim().replace(/^\/+/, "");
  const build = t.match(/^build\s+(?:a\s+)?packet\s+(?:from|for)\s+(.+)$/i);
  if (build) return { kind: "build", target: build[1].trim().replace(/^["']|["']$/g, "") };
  const explain = t.match(/^explain\s+(?:option\s+)?([A-D])\b/i);
  if (explain) return { kind: "explain", option: explain[1].toUpperCase() as OptionId };
  return { kind: "help" };
}

export const HELP = [
  "Structure Studio commands:",
  '  build packet from <property id or address>   e.g. "build packet from allsop-6392cf9c"',
  "  explain option <A|B|C|D>                     uses the last packet built",
].join("\n");

/** Default investor mix, same as fixtures/sample.json. */
export const DEFAULT_INVESTORS: Investor[] = [
  { type: "uk_pension", label: "UK pension fund", pct: 60 },
  { type: "family_office_uk", label: "UK family office", pct: 40 },
];

export interface StudioApi {
  properties(q: string): Promise<Property[]>;
  match(req: MatchRequest): Promise<Packet>;
  structures(packet: Packet, investors: Investor[]): Promise<Structure[]>;
  engine(packet: Packet, structures: Structure[], investors: Investor[]): Promise<EngineResult>;
}

/** HTTP client against a running app (local or Vercel). */
export function httpApi(baseUrl: string): StudioApi {
  const base = baseUrl.replace(/\/$/, "");
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} failed (${res.status}): ${(body as { error?: string }).error ?? "unknown error"}`);
    return body as T;
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
  return {
    properties: (q) => call(`/api/properties?q=${encodeURIComponent(q)}&limit=5`),
    match: (req) => call("/api/match", post(req)),
    structures: async (packet, investors) => (await call<{ structures: Structure[] }>("/api/structures", post({ packet, investors }))).structures,
    engine: (packet, structures, investors) => call("/api/engine", post({ packet, structures, investors })),
  };
}

export interface BuildRun {
  packet: Packet;
  structures: Structure[];
  result: EngineResult;
  investors: Investor[];
  app_url: string;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
export const money = (n: number) => gbp.format(n);

const looksLikeId = (s: string) => /^[a-z0-9]+-[a-z0-9]+$/i.test(s) && !/\s/.test(s);

export async function buildPacket(target: string, api: StudioApi, opts: { appUrl: string; investors?: Investor[]; n?: number }): Promise<BuildRun> {
  let seedId = target;
  if (!looksLikeId(target)) {
    const hits = await api.properties(target);
    if (hits.length === 0) throw new Error(`No property matches "${target}". Try a property id such as allsop-6392cf9c.`);
    seedId = hits[0].id;
  }
  const investors = opts.investors ?? DEFAULT_INVESTORS;
  const packet = await api.match({ seed_id: seedId, n: opts.n ?? 5 });
  const structures = await api.structures(packet, investors);
  const result = await api.engine(packet, structures, investors);
  return { packet, structures, result, investors, app_url: `${opts.appUrl.replace(/\/$/, "")}/studio/${encodeURIComponent(packet.id)}` };
}

const STAGE_LABEL: Record<Stage, string> = {
  acquire: "on purchase",
  hold: "a year while held",
  exit: "on exit",
  ten_year: "every 10 years",
  death: "on death (comparator)",
};
const STAGE_ORDER: Stage[] = ["acquire", "hold", "exit", "ten_year", "death"];

function optionLine(result: EngineResult, s: Structure): string {
  const t = result.totals[s.option] ?? {};
  const parts = STAGE_ORDER.filter((st) => t[st] !== undefined).map((st) => `${money(t[st]!)} ${STAGE_LABEL[st]}`);
  return `${s.option}. ${s.name}: ${parts.length ? parts.join(" · ") : "no modelled tax"}`;
}

/** Short chat reply for "build packet". Quotes figures only; computes nothing. */
export function formatBuildReply(run: BuildRun): string {
  const { packet, structures, result } = run;
  const seed = packet.items[0];
  const review = result.flags.filter((f) => f.severity === "review").length;
  return [
    `Packet ${packet.id}: ${packet.items.length} ${seed?.use ?? ""} properties, ${money(packet.totals.price_gbp)} in total (seed: ${seed?.address ?? packet.seed_id}).`,
    packet.match_reason,
    "",
    ...structures.map((s) => optionLine(result, s)),
    "",
    `${review} point${review === 1 ? "" : "s"} need an adviser's review. Say "explain option A-D" for detail.`,
    `Open in Structure Studio: ${run.app_url}`,
    "Decision support, not tax advice.",
  ].join("\n");
}

/** Every £ amount the bot is allowed to say for an option: row amounts, stage totals, packet total. */
export function allowedAmounts(run: BuildRun, option: OptionId): Set<number> {
  const set = new Set<number>([run.packet.totals.price_gbp]);
  for (const r of run.result.rows) if (r.option === option) {
    set.add(r.amount_gbp);
    for (const i of r.inputs) if (typeof i.value === "number") set.add(i.value);
  }
  for (const v of Object.values(run.result.totals[option] ?? {})) if (v !== undefined) set.add(v);
  return set;
}

/** Pounds amounts mentioned in text, e.g. "£34,000" (exact), "£216k" / "£1.4m" (shorthand, carries its rounding step). */
export function poundsIn(text: string): { value: number; step: number }[] {
  const out: { value: number; step: number }[] = [];
  for (const m of text.matchAll(/£\s?(\d[\d,]*(?:\.(\d+))?)\s?(k|m|bn)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    const mult = { k: 1e3, m: 1e6, bn: 1e9 }[(m[3] ?? "").toLowerCase() as "k" | "m" | "bn"] ?? 1;
    const decimals = m[2]?.length ?? 0;
    out.push({ value: Math.round(n * mult), step: mult === 1 ? 0 : mult / 10 ** decimals });
  }
  return out;
}

/** True if every £ figure in text is an allowed amount; shorthand must round to the same value. */
export function quotesOnly(text: string, allowed: Set<number>): boolean {
  return poundsIn(text).every(({ value, step }) =>
    step === 0 ? allowed.has(value) : [...allowed].some((a) => Math.abs(a - value) <= step / 2),
  );
}

/** Deterministic explanation straight from the rows. Used when Grok is unavailable or its text fails the check. */
export function templateExplanation(run: BuildRun, option: OptionId): string {
  const s = run.structures.find((x) => x.option === option);
  const rows = run.result.rows.filter((r) => r.option === option);
  const flags = run.result.flags.filter((f) => f.option === option);
  const lines = [`Option ${option}${s ? `: ${s.name}` : ""}.`];
  if (s?.rationale) lines.push(s.rationale);
  lines.push("");
  for (const st of STAGE_ORDER) {
    const rs = rows.filter((r) => r.stage === st);
    if (!rs.length) continue;
    lines.push(`${STAGE_LABEL[st][0].toUpperCase()}${STAGE_LABEL[st].slice(1)}:`);
    for (const r of rs) lines.push(`  - ${r.tax.replace(/_/g, " ")} ${money(r.amount_gbp)}: ${r.formula} [${r.rule.citation_url}]`);
  }
  if (!rows.length) lines.push("No modelled tax for this option.");
  if (flags.length) {
    lines.push("", "Check with an adviser:");
    for (const f of flags) lines.push(`  - ${f.severity === "review" ? "[review]" : "[info]"} ${f.message}`);
  }
  lines.push("", "Decision support, not tax advice.");
  return lines.join("\n");
}

const ExplainSchema = z.object({ text: z.string().min(20).max(1500) });

const EXPLAIN_SYSTEM = [
  "You explain UK property ownership structures to an investment committee in plain English.",
  "You are given one option's structure and the tax rows a deterministic engine produced.",
  "Rules: quote only £ figures that appear in the rows or totals you are given, written exactly as given (e.g. £34,000).",
  "Never calculate, add, subtract or estimate any number. Never invent a tax, rate or relief not in the input.",
  "Say which costs are one-off, annual, on exit, every ten years, and which is only a comparator.",
  "Mention the review flags as things to check with an adviser. Max 6 sentences.",
  'Return {"text": "..."}.',
].join(" ");

export function explainPrompt(run: BuildRun, option: OptionId): string {
  const s = run.structures.find((x) => x.option === option);
  return JSON.stringify({
    option,
    name: s?.name,
    nodes: s?.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, jurisdiction: n.jurisdiction })),
    rows: run.result.rows
      .filter((r) => r.option === option)
      .map((r) => ({ stage: r.stage, tax: r.tax, amount: money(r.amount_gbp), borne_by: r.entity_id, formula: r.formula })),
    totals: Object.fromEntries(Object.entries(run.result.totals[option] ?? {}).map(([k, v]) => [k, money(v!)])),
    flags: run.result.flags.filter((f) => f.option === option).map((f) => ({ severity: f.severity, message: f.message })),
  });
}

/** Grok writes the prose; any £ figure not quoted from the engine rejects it in favour of the template. */
export async function explainOption(
  run: BuildRun,
  option: OptionId,
  transport?: Transport,
): Promise<{ text: string; source: "grok" | "template"; warning?: string }> {
  if (!run.structures.some((s) => s.option === option)) {
    return { text: `Option ${option} is not in the last packet.`, source: "template" };
  }
  try {
    const r = await grokJson({ task: "bot-explain-option", system: EXPLAIN_SYSTEM, user: explainPrompt(run, option), schema: ExplainSchema }, transport);
    if (!quotesOnly(r.text, allowedAmounts(run, option))) {
      return { text: templateExplanation(run, option), source: "template", warning: "Grok used a figure not in the engine output; showing the engine rows instead." };
    }
    return { text: `${r.text}\n\nOpen the studio for every source: ${run.app_url}\nDecision support, not tax advice.`, source: "grok" };
  } catch (e) {
    return { text: templateExplanation(run, option), source: "template", warning: `Grok unavailable (${(e as Error).message}); showing the engine rows.` };
  }
}
