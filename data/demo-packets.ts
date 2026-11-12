/**
 * Build demo packets from data/raw via the same code path as POST /api/match (offline store).
 * Run: npx tsx data/demo-packets.ts [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { getProperty, matchCandidates } from "../lib/db";
import { buildPacket } from "../lib/mapping/match";
import type { MatchRequest } from "../lib/mapping/types";

const DEMOS: { file: string; req: MatchRequest }[] = [
  { file: "demo-commercial.json", req: { seed_id: "allsop-6392cf9c", n: 5 } },
  { file: "demo-residential.json", req: { seed_id: process.env.RES_SEED ?? "allsop-8585b2be", n: 4, min_dwellings: 6 } },
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
    console.log(`\n${d.file}  seed=${seed.id} ${seed.name}  (${ms} ms)`);
    for (const i of pk.items) console.log(`  ${i.property.id.padEnd(22)} ${i.property.use.padEnd(11)} ${String(i.property.price_gbp?.value).padStart(9)} ${i.property.price_kind}  ${i.property.source.file}#${i.property.source.row}  ${i.property.name.slice(0, 50)}`);
    console.log("  totals", pk.totals, pk.criteria);
    if (write) fs.writeFileSync(path.join("fixtures", d.file), JSON.stringify(pk, null, 2) + "\n");
  }
}
main();
