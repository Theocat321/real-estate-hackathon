/**
 * Property store. Uses Supabase when NEXT_PUBLIC_SUPABASE_URL + a key are set,
 * otherwise falls back to an in-memory index built from data/raw/*.csv (offline / DEMO_MODE).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Property, PropertiesQuery } from "@/contracts";
import { readRawCsvs } from "./csv";


let client: SupabaseClient | null | undefined;
export function supabase(admin = false): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = admin ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (admin) return createClient(url, key, { auth: { persistSession: false } });
  if (client === undefined) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

let memory: Property[] | null = null;
function memoryStore(): Property[] {
  if (!memory) memory = readRawCsvs().properties;
  return memory;
}

function useSupabase(): boolean {
  return process.env.DEMO_MODE !== "1" && supabase() != null;
}

/** Row in the `properties` table: indexed columns + full Property as jsonb `data`. */
export function toDbRow(p: Property) {
  return {
    id: p.id,
    use: p.use,
    nation: p.nation,
    postcode_area: p.postcode_area,
    property_type: p.property_type,
    address: p.address,
    postcode: p.postcode || null,
    price_gbp: p.price_gbp,
    rent_pa_gbp: p.rent_pa_gbp,
    yield_pct: p.yield_pct,
    source_file: p.price_gbp?.source.file ?? p.rent_pa_gbp?.source.file ?? null,
    data: p,
  };
}

export async function listProperties(query: PropertiesQuery = {}): Promise<Property[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  const q = query.q?.trim();
  if (useSupabase()) {
    let req = supabase()!.from("properties").select("data").limit(limit);
    if (query.use) req = req.eq("use", query.use);
    if (q) {
      const safe = q.replace(/[%,()]/g, " ");
      req = req.or(`address.ilike.%${safe}%,postcode.ilike.%${safe}%`);
    }
    const { data, error } = await req;
    if (error) throw new Error(`supabase listProperties: ${error.message}`);
    return (data ?? []).map((r) => r.data as Property);
  }
  const needle = q?.toLowerCase();
  return memoryStore()
    .filter((p) => (!query.use || p.use === query.use) && (!needle || p.address.toLowerCase().includes(needle) || p.postcode.toLowerCase().includes(needle)))
    .slice(0, limit);
}

export async function getProperty(id: string): Promise<Property | null> {
  if (useSupabase()) {
    const { data, error } = await supabase()!.from("properties").select("data").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase getProperty: ${error.message}`);
    return (data?.data as Property) ?? null;
  }
  return memoryStore().find((p) => p.id === id) ?? null;
}

/** Candidates for matching: same use+nation as the seed, plus all residential (for min_dwellings top-up). */
export async function matchCandidates(seed: Property): Promise<Property[]> {
  if (useSupabase()) {
    const { data, error } = await supabase()!
      .from("properties")
      .select("data")
      .eq("nation", seed.nation)
      .or(`use.eq.${seed.use},use.eq.residential`)
      .limit(5000);
    if (error) throw new Error(`supabase matchCandidates: ${error.message}`);
    return (data ?? []).map((r) => r.data as Property);
  }
  return memoryStore().filter((p) => p.nation === seed.nation && (p.use === seed.use || p.use === "residential"));
}
