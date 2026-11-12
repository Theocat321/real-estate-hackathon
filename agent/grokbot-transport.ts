/**
 * Grok via the Grok Bot desktop app instead of an xAI API key (macOS only).
 *
 * Sends each request to a dedicated Grok Bot teammate with grokbot.py (github.com/adamanz/grok-bot-skill)
 * and returns its reply text. grokJson() still strips fences, validates with zod, retries once and caches,
 * so a demo deploy can replay the cache with DEMO_MODE=1.
 *
 * Env:
 *   GROK_TRANSPORT=grokbot      select this transport (see agent/grok.ts)
 *   GROKBOT_SCRIPT              path to grokbot.py (default ~/.cursor/skills/grok-bot/scripts/grokbot.py)
 *   GROKBOT_NAME                teammate name (default "Structure Studio JSON"; create it with agent/bot/setup-grokbot.ts)
 *   GROKBOT_TIMEOUT_S           seconds to wait for a reply (default 120)
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Transport } from "./grok";

export const GROKBOT_DEFAULT_NAME = "Structure Studio JSON";

export function grokBotScript(): string {
  return process.env.GROKBOT_SCRIPT || path.join(homedir(), ".cursor", "skills", "grok-bot", "scripts", "grokbot.py");
}

export function runGrokBot(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("python3", ["-I", grokBotScript(), ...args], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        let msg = stderr.trim();
        try {
          msg = (JSON.parse(msg) as { error?: string }).error ?? msg;
        } catch {}
        reject(new Error(`Grok Bot: ${msg || err.message}`));
      } else resolve(stdout);
    });
  });
}

/** Flatten chat messages into one prompt; Grok Bot keeps its own thread, so make each request self-contained. */
export function toPrompt(messages: Parameters<Transport>[0]): string {
  const parts = [`REQUEST ${randomUUID().slice(0, 8)}. Answer only this request; ignore earlier messages in this chat.`];
  for (const m of messages) {
    const tag = m.role === "system" ? "INSTRUCTIONS" : m.role === "assistant" ? "YOUR PREVIOUS ANSWER" : "INPUT";
    parts.push(`### ${tag}\n${m.content}`);
  }
  parts.push("Reply with exactly one JSON object and nothing else. Do not use tools, files or the web.");
  return parts.join("\n\n");
}

interface ChatOutput {
  timedOut?: boolean;
  newEntries?: { kind?: string; author?: string; text?: string }[];
}

/** Last non-empty reply that isn't our own prompt echoed back. */
export function replyFrom(stdout: string, prompt: string): string {
  const out = JSON.parse(stdout) as ChatOutput;
  const texts = (out.newEntries ?? [])
    .map((e) => e.text ?? "")
    .filter((t) => t.trim() && t.trim() !== prompt.trim());
  if (!texts.length) throw new Error(out.timedOut ? "Grok Bot timed out without replying" : "Grok Bot returned no reply");
  return texts[texts.length - 1];
}

export const grokBotTransport: Transport = async (messages) => {
  const prompt = toPrompt(messages);
  const timeoutS = Number(process.env.GROKBOT_TIMEOUT_S || 120);
  const stdout = await runGrokBot(
    ["chat", "--name", process.env.GROKBOT_NAME || GROKBOT_DEFAULT_NAME, "--prompt", prompt, "--timeout", String(timeoutS)],
    (timeoutS + 30) * 1000,
  );
  return replyFrom(stdout, prompt);
};
