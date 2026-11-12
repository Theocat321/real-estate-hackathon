/**
 * Load data/raw/*.csv into Supabase `properties` and print counts.
 * Run: npx tsx data/load.ts            (upserts if Supabase env set)
 *      npx tsx data/load.ts --dry-run  (counts only)
 */
import { readRawCsvs, RAW_DIR } from "../lib/db/csv";
import { supabase, toDbRow } from "../lib/db";
import type { Property } from "../lib/mapping/types";

function countBy(ps: Property[], key: (p: Property) => string | null, top?: number) {
  const m = new Map<string, number>();
  for (const p of ps) {
    const k = key(p) ?? "(none)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(top ? rows.slice(0, top) : rows);
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const { properties, reports } = readRawCsvs();
  if (!reports.length) {
    console.error(`No CSVs in ${RAW_DIR}. Drop the hackathon listings/auction CSVs there.`);
    process.exit(1);
  }
  console.log("Files:");
  for (const r of reports) console.log(`  ${r.file}: kind=${r.kind ?? "UNKNOWN (skipped)"} rows=${r.rows} mapped=${r.mapped}`);

  const counts = {
    total: properties.length,
    by_use: countBy(properties, (p) => p.use),
    by_property_type_top20: countBy(properties, (p) => p.property_type, 20),
    by_nation: countBy(properties, (p) => p.nation),
    by_source_file: countBy(properties, (p) => p.source.file ?? null),
    with_price: properties.filter((p) => p.price_gbp).length,
    with_rent: properties.filter((p) => p.rent_pa_gbp).length,
    with_yield: properties.filter((p) => p.yield_pct).length,
  };
  console.log(JSON.stringify(counts, null, 2));

  if (dry) return;
  const db = supabase(true);
  if (!db) {
    console.warn("Supabase env not set (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Skipping upsert.");
    return;
  }
  const rows = properties.map(toDbRow);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("properties").upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(`upsert batch ${i}: ${error.message}`);
  }
  console.log(`Upserted ${rows.length} properties.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
