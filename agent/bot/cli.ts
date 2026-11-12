#!/usr/bin/env -S npx tsx
/**
 * Structure Studio Grok Bot CLI.
 *
 *   npx tsx agent/bot/cli.ts "build packet from allsop-6392cf9c"
 *   npx tsx agent/bot/cli.ts "explain option D"
 *   npx tsx agent/bot/cli.ts --json "build packet from Wireless House"
 *
 * Env: STUDIO_URL (default http://localhost:3000), DEMO_MODE=1 for cache-only Grok.
 * The last build is saved to fixtures/cache/bot/last-run.json so "explain" can quote it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HELP, buildPacket, explainOption, formatBuildReply, httpApi, parseCommand, type BuildRun } from "./commands";

const STATE = path.join(process.cwd(), "fixtures", "cache", "bot", "last-run.json");

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const text = args.filter((a) => a !== "--json").join(" ");
  const cmd = parseCommand(text);
  const appUrl = process.env.STUDIO_URL || "http://localhost:3000";
  const print = (reply: string, extra: object = {}) =>
    console.log(json ? JSON.stringify({ reply, ...extra }, null, 2) : reply);

  if (cmd.kind === "help") {
    print(HELP);
    return text.trim() ? 2 : 0;
  }

  if (cmd.kind === "build") {
    const run = await buildPacket(cmd.target, httpApi(appUrl), { appUrl });
    await mkdir(path.dirname(STATE), { recursive: true });
    await writeFile(STATE, JSON.stringify(run, null, 2));
    print(formatBuildReply(run), { packet_id: run.packet.id, app_url: run.app_url, totals: run.result.totals });
    return 0;
  }

  let run: BuildRun;
  try {
    run = JSON.parse(await readFile(STATE, "utf8"));
  } catch {
    print('No packet yet. Run "build packet from <property id or address>" first.');
    return 1;
  }
  const r = await explainOption(run, cmd.option);
  if (r.warning) console.error(r.warning);
  print(r.text, { option: cmd.option, source: r.source, packet_id: run.packet.id });
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  },
);
