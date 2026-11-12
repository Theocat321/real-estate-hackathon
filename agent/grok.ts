/**
 * Grok client (xAI, OpenAI-compatible). JSON-only, zod-validated, cached.
 *
 * - Every successful response is cached at fixtures/cache/<sha1 of request>.json.
 * - DEMO_MODE=1 serves only from cache (throws GrokCacheMiss otherwise, never hits the network).
 * - Invalid JSON / schema mismatch is retried once with the validation error fed back.
 * - 20 s timeout per call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { z } from "zod";

export const GROK_TIMEOUT_MS = 20_000;
/** fixtures/cache under the project root; GROK_CACHE_DIR overrides (tests). */
export function cacheDir(): string {
  return process.env.GROK_CACHE_DIR || path.join(process.cwd(), "fixtures", "cache");
}

export class GrokCacheMiss extends Error {
  constructor(public key: string) {
    super(`DEMO_MODE=1 and no cached Grok response for ${key}`);
    this.name = "GrokCacheMiss";
  }
}

export class GrokInvalidResponse extends Error {
  constructor(message: string, public raw: string) {
    super(message);
    this.name = "GrokInvalidResponse";
  }
}

export interface GrokRequest<S extends z.ZodType> {
  /** Short tag, part of the cache key so different tasks never collide. */
  task: string;
  system: string;
  user: string;
  schema: S;
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

/**
 * Cache key = sha1 of the request (task + prompts). The model name is deliberately
 * excluded so a demo deploy with a different/missing XAI_MODEL still hits the cache.
 */
export function cacheKey(req: { task: string; system: string; user: string }): string {
  return createHash("sha1").update(JSON.stringify({ task: req.task, system: req.system, user: req.user })).digest("hex");
}

interface CacheEntry {
  key: string;
  task: string;
  model: string;
  created_at: string;
  request: { system: string; user: string };
  response: unknown;
}

async function readCache(key: string): Promise<CacheEntry | null> {
  try {
    return JSON.parse(await readFile(path.join(cacheDir(), `${key}.json`), "utf8")) as CacheEntry;
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(path.join(cacheDir(), `${entry.key}.json`), JSON.stringify(entry, null, 2) + "\n");
  } catch {
    // Read-only FS (e.g. Vercel). Cache is a best-effort accelerator, not required for correctness.
  }
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.XAI_API_KEY) throw new Error("XAI_API_KEY is not set (or set DEMO_MODE=1 to serve from cache)");
  client ??= new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1", timeout: GROK_TIMEOUT_MS, maxRetries: 0 });
  return client;
}

export function grokModel(): string {
  return process.env.XAI_MODEL || "grok-4";
}

/** Strip ```json fences and surrounding prose; return the outermost JSON object text. */
export function extractJsonText(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = (fenced ? fenced[1] : raw).trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

function validate<S extends z.ZodType>(schema: S, raw: string): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch (e) {
    return { ok: false, error: `Response was not valid JSON: ${(e as Error).message}` };
  }
  const r = schema.safeParse(parsed);
  if (!r.success) return { ok: false, error: `JSON did not match schema: ${r.error.message}` };
  return { ok: true, data: r.data };
}

/** Injectable transport so tests never touch the network. */
export type Transport = (messages: { role: "system" | "user" | "assistant"; content: string }[]) => Promise<string>;

const apiTransport: Transport = async (messages) => {
  const res = await getClient().chat.completions.create(
    { model: grokModel(), messages, response_format: { type: "json_object" }, temperature: 0 },
    { timeout: GROK_TIMEOUT_MS },
  );
  return res.choices[0]?.message?.content ?? "";
};

/** GROK_TRANSPORT=grokbot routes calls through the Grok Bot desktop app (macOS) instead of XAI_API_KEY. */
const defaultTransport: Transport = async (messages) => {
  if (process.env.GROK_TRANSPORT === "grokbot") {
    const { grokBotTransport } = await import("./grokbot-transport");
    return grokBotTransport(messages);
  }
  return apiTransport(messages);
};

export async function grokJson<S extends z.ZodType>(req: GrokRequest<S>, transport: Transport = defaultTransport): Promise<z.output<S>> {
  const key = cacheKey(req);
  const cached = await readCache(key);
  if (cached) {
    const r = req.schema.safeParse(cached.response);
    if (r.success) return r.data;
    if (isDemoMode()) throw new GrokInvalidResponse(`Cached response ${key} no longer matches schema`, JSON.stringify(cached.response));
  }
  if (isDemoMode()) throw new GrokCacheMiss(key);

  const system = `${req.system}\n\nRespond with a single JSON object only. No prose, no markdown fences.`;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: req.user },
  ];

  let raw = await transport(messages);
  let v = validate(req.schema, raw);
  if (!v.ok) {
    // Retry once, telling the model what was wrong.
    messages.push({ role: "assistant", content: raw }, { role: "user", content: `${v.error}\nReturn corrected JSON only.` });
    raw = await transport(messages);
    v = validate(req.schema, raw);
    if (!v.ok) throw new GrokInvalidResponse(v.error, raw);
  }

  await writeCache({
    key,
    task: req.task,
    model: grokModel(),
    created_at: new Date().toISOString(),
    request: { system: req.system, user: req.user },
    response: JSON.parse(extractJsonText(raw)),
  });
  return v.data;
}
