import type { Use } from "@/contracts";

/** Inline status message. Errors say what happened; review notes flag adviser checks. */
export function Notice({ tone, children }: { tone: "error" | "review" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-edge bg-edge-soft text-edge"
      : tone === "review"
        ? "border-review/40 bg-review-soft text-review"
        : "border-rule bg-sheet text-ink-soft";
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`rounded-md border-l-[3px] px-3.5 py-2.5 text-[13px] leading-snug ${cls}`}>
      {children}
    </div>
  );
}

const USE_LABEL: Record<Use, string> = { commercial: "Commercial", residential: "Residential", mixed: "Mixed use" };

export function UseTag({ use }: { use: Use }) {
  const cls = use === "residential" ? "bg-sage-soft text-sage" : use === "mixed" ? "bg-review-soft text-review" : "bg-paper text-ink-soft";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{USE_LABEL[use]}</span>;
}

/** Label + value pair used for figures in headers. */
export function Figure({ label, children, big }: { label: string; children: React.ReactNode; big?: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`tabular mt-0.5 font-semibold ${big ? "wide text-[26px] tracking-tight" : "text-[17px]"}`}>{children}</p>
    </div>
  );
}
