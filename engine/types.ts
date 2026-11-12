import type { Option, SourceRef, Stage } from "./schema";
export type { Option, Stage, SourceRef, Property, Structure, StructureNode, ScenarioInput, ScenarioInputRaw } from "./schema";

export type TaxCode =
  | "SDLT_NONRES"
  | "SDLT_RES_HIGHER"
  | "SDLT_RES_COMPANY_17"
  | "STAMP_DUTY_SHARES"
  | "ATED"
  | "IHT_ENTRY"
  | "IHT_TEN_YEAR"
  | "IHT_DEATH_COMPARATOR";

export interface RuleRef {
  id: string;
  name: string;
  citation_url: string;
  as_of: string;
}

export interface RowInput {
  label: string;
  value: number | string;
  source: SourceRef;
}

export interface CostRow {
  id: string;
  option: Option;
  stage: Stage;
  tax: TaxCode;
  amount_gbp: number;
  formula: string;
  inputs: RowInput[];
  rule: RuleRef;
  property_ids: string[];
  payer_node_id: string;
  annual?: boolean;
  /** True when the row is a comparator, not a cost of the option. */
  comparator?: boolean;
}

export interface Flag {
  id: string;
  option: Option | null;
  severity: "info" | "review";
  message: string;
  property_ids?: string[];
  rule?: RuleRef;
}

export type Totals = Partial<Record<Option, Partial<Record<Stage, number>>>>;

export interface EngineResult {
  contract_version: string;
  rows: CostRow[];
  flags: Flag[];
  totals: Totals;
}
