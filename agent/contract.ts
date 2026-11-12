/**
 * Agent-side view of the shared contract. Types come from contracts/index.ts (never edited here);
 * this file only adds the zod schemas the agent needs to validate requests and Grok output.
 */
import { z } from "zod";

export * from "@/contracts";
import type { OptionId } from "@/contracts";

export const OPTIONS: readonly OptionId[] = ["A", "B", "C", "D"] as const;

export const InvestorTypeSchema = z.enum(["uk_pension", "family_office_uk", "family_office_nonuk", "uk_company"]);

export const InvestorSchema = z.object({
  type: InvestorTypeSchema,
  label: z.string().min(1),
  pct: z.number().min(0).max(100),
});
