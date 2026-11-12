/**
 * Build demo packets from data/raw via the same code path as POST /api/match (offline store).
 * Run: npx tsx data/demo-packets.ts [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { getProperty, matchCandidates } from "../lib/db";
import { buildPacket } from "../lib/mapping/match";
import type { MatchRequest } from "../contracts";

const DEMOS: { file: string; req: MatchRequest }[] = [
  { file: "demo-commercial.json", req: { seed_id: "allsop-6392cf9c", n: 5 } },
  { file: "demo-residential.json", req: { seed_id: process.env.RES_SEED ?? "allsop-8585b2be", n: 5, min_dwellings: 6 } },
];

async function main() {
  process.env.DEMO_MODE = "1"; // force offline CSV store
  const write = process.argv.includes("--write");
  for (const d of DEMOS) {
    const seed = await getProperty(d.req.seed_id);
    if (!seed) { console.error(`seed ${d.req.seed_id} not found`); continue; }
    const t0 = performance.now();
    const pk = buildPacket(seed, await matchCandidates(seed), d.req);
    const ms = Math.round(performance.now() - t0);
    console.log(`\n${d.file}  seed=${seed.id} ${seed.address}  (${ms} ms)`);
    for (const i of pk.items) console.log(`  ${i.id.padEnd(22)} ${i.use.padEnd(11)} ${String(i.price_gbp?.value).padStart(9)} ${i.price_kind}  ${i.price_gbp?.source.file}#${i.price_gbp?.source.row}  ${i.address.slice(0, 50)}`);
    console.log("  totals", JSON.stringify(pk.totals), "\n  ", pk.match_reason);
    if (write) fs.writeFileSync(path.join("fixtures", d.file), JSON.stringify(pk, null, 2) + "\n");
  }
}
main();
