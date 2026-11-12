/** Directory of firms and official registers that can put a structure in place. */
import type { OptionId } from "@/contracts";
import data from "@/data/structurers.json";
import type { RoleId } from "@/lib/setup";

export interface Firm {
  name: string;
  roles: RoleId[];
  options: OptionId[];
  jurisdiction: string;
  url: string;
  evidence_url: string;
  summary: string;
}

export interface Register {
  name: string;
  roles: RoleId[];
  url: string;
  how: string;
}

export interface Directory {
  as_of: string;
  note: string;
  roles: Partial<Record<RoleId, { label: string; why: string }>>;
  options: Record<OptionId, RoleId[]>;
  firms: Firm[];
  registers: Register[];
}


/** Researched 2026-11-12: each firm checked against its own site, each register fetched. Orientation, not endorsement. */
export const DIRECTORY: Directory | null = data as unknown as Directory;
