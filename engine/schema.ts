import { z } from "zod";

export const CONTRACT_VERSION = "1.0.0";

export const OptionSchema = z.enum(["A", "B", "C", "D"]);
export const StageSchema = z.enum(["acquire", "hold", "exit", "ten_year", "death"]);

export const SourceRefSchema = z.object({
  kind: z.enum(["listing", "auction", "brochure", "hmlr", "user", "assumption"]),
  file: z.string().optional(),
  row: z.number().int().optional(),
  page: z.number().int().optional(),
  record_id: z.string().optional(),
  excerpt: z.string().optional(),
  label: z.string().min(1),
  url: z.string().optional(),
  ref: z.string().optional(),
});

export const PropertySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nation: z.enum(["england", "ni", "scotland", "wales"]).default("england"),
  use: z.enum(["residential", "commercial", "mixed"]),
  price_gbp: z.number().int().nonnegative(),
  /** Number of dwellings in this property (residential only). */
  dwellings: z.number().int().nonnegative().default(1),
  source: SourceRefSchema,
});

export const StructureNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["investor", "propco", "fund", "trust", "settlor", "beneficiary", "property"]),
  label: z.string().min(1),
  entity_type: z.enum(["individual", "company", "trust", "unit_trust"]).optional(),
});

export const StructureEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.string().optional(),
});

export const StructureSchema = z.object({
  option: OptionSchema,
  label: z.string().optional(),
  nodes: z.array(StructureNodeSchema).min(1),
  edges: z.array(StructureEdgeSchema).default([]),
});

export const ScenarioInputSchema = z.object({
  contract_version: z.string().optional(),
  scenario_id: z.string().optional(),
  properties: z.array(PropertySchema).min(1),
  structures: z.array(StructureSchema).min(1),
  settlor_nrb_available_gbp: z.number().int().nonnegative().default(325000),
});

export type Option = z.infer<typeof OptionSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Property = z.output<typeof PropertySchema>;
export type StructureNode = z.infer<typeof StructureNodeSchema>;
export type Structure = z.output<typeof StructureSchema>;
/** Parsed (defaults applied) scenario. */
export type ScenarioInput = z.output<typeof ScenarioInputSchema>;
/** Raw scenario as sent over the wire (defaults optional). */
export type ScenarioInputRaw = z.input<typeof ScenarioInputSchema>;
