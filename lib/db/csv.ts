import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { rowKind, rowToProperty, type CsvRow } from "@/lib/mapping";
import type { Property } from "@/lib/mapping/types";

export const RAW_DIR = path.join(process.cwd(), "data", "raw");

export interface CsvLoadReport {
  file: string;
  kind: "listing" | "auction" | null;
  rows: number;
  mapped: number;
}

/** Parse one CSV text into Properties. Row numbers are 1-based data rows (header excluded). */
export function parseCsvText(text: string, file: string): { properties: Property[]; report: CsvLoadReport } {
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const kind = rowKind(parsed.meta.fields ?? []);
  const properties = kind ? parsed.data.map((r, i) => rowToProperty(kind, r, i + 1, file)) : [];
  return { properties, report: { file, kind, rows: parsed.data.length, mapped: properties.length } };
}

/** Read every data/raw/*.csv. Later files win on duplicate id. */
export function readRawCsvs(dir = RAW_DIR): { properties: Property[]; reports: CsvLoadReport[] } {
  if (!fs.existsSync(dir)) return { properties: [], reports: [] };
  const byId = new Map<string, Property>();
  const reports: CsvLoadReport[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".csv")).sort()) {
    const { properties, report } = parseCsvText(fs.readFileSync(path.join(dir, f), "utf8"), f);
    reports.push(report);
    for (const p of properties) byId.set(p.id, p);
  }
  return { properties: [...byId.values()], reports };
}
