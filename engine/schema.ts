// Zod mirror of contracts/index.ts ScenarioInput (validation only; types come from the contract).
import { z } from "zod";
import type { ScenarioInput } from "@/contracts";

export const SourceRefSchema = z.object({
  kind: z.enum(["listing", "auction", "brochure", "upload", "rule", "user"]),
  file: z.string(),
  row: z.number().int().optional(),
  page: z.number().int().optional(),
  record_id: z.string().optional(),
  url: z.string().optional(),
  excerpt: z.string().optional(),
});

const sourcedNumber = z.object({ value: z.number(), source: SourceRefSchema });

export const PropertySchema = z.object({
  id: z.string().min(1),
  address: z.string(),
  postcode: z.string(),
  postcode_area: z.string(),
  nation: z.enum(["england", "wales", "scotland", "ni"]),
  use: z.enum(["commercial", "residential", "mixed"]),
  property_type: z.string(),
  tenure: z.enum(["freehold", "leasehold", "unknown"]),
  price_gbp: sourcedNumber.nullable(),
  price_kind: z.enum(["asking", "guide", "achieved", "hmlr"]).nullable(),
  rent_pa_gbp: sourcedNumber.nullable(),
  yield_pct: sourcedNumber.nullable(),
  size_sqft: sourcedNumber.nullable(),
  dwellings: z.number().int().nonnegative(),
});

export const InvestorType = z.enum(["uk_pension", "family_office_uk", "family_office_nonuk", "uk_company"]);

export const StructNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["investor", "trust", "fund", "company", "property"]),
  label: z.string(),
  jurisdiction: z.enum(["UK", "Jersey", "Guernsey", "Luxembourg", "Other"]).optional(),
  investor_type: InvestorType.optional(),
  trust_type: z.enum(["discretionary", "unit_trust"]).optional(),
  fund_type: z.enum(["JPUT", "RIF"]).optional(),
  property_id: z.string().optional(),
});

export const StructureSchema = z.object({
  option: z.enum(["A", "B", "C", "D"]),
  name: z.string(),
  nodes: z.array(StructNodeSchema).min(1),
  edges: z.array(z.object({ from: z.string(), to: z.string(), pct: z.number() })),
  rationale: z.string(),
});

export const ScenarioInputSchema: z.ZodType<ScenarioInput> = z.object({
  packet: z.object({
    id: z.string(),
    seed_id: z.string(),
    items: z.array(PropertySchema).min(1),
    totals: z.object({
      price_gbp: z.number(),
      rent_pa_gbp: z.number(),
      blended_yield_pct: z.number().nullable(),
      dwellings: z.number(),
    }),
    match_reason: z.string(),
  }),
  structures: z.array(StructureSchema).min(1),
  investors: z.array(z.object({ type: InvestorType, label: z.string(), pct: z.number() })),
  settlor_nrb_available_gbp: z.number().int().nonnegative().optional(),
  assumptions: z
    .object({ rental_relief: z.boolean().optional(), distribute_profits: z.boolean().optional() })
    .optional(),
});
