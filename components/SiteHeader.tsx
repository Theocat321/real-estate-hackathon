"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
  { key: "start", label: "Pick a property" },
  { key: "packet", label: "Review the packet" },
  { key: "studio", label: "Compare structures" },
  { key: "setup", label: "Set it up" },
] as const;

/** Wordmark: a small parcel with red title-plan edging. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      <path d="M3 6.5 11 2l8 4.5v9L11 20l-8-4.5z" fill="#fff" stroke="var(--color-edge)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M11 2v18M3 6.5l8 4.5 8-4.5" fill="none" stroke="var(--color-ink)" strokeWidth="1" />
    </svg>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const current = path.startsWith("/setup") ? 3 : path.startsWith("/studio") ? 2 : path.startsWith("/packet") ? 1 : 0;
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="wide text-[15px] font-bold tracking-tight">Structure Studio</span>
        </Link>
        <ol className="ml-auto hidden items-center gap-1 text-[13px] md:flex" aria-label="Progress">
          {STEPS.map((s, i) => {
            const state = i < current ? "done" : i === current ? "now" : "next";
            return (
              <li key={s.key} className="flex items-center gap-1">
                {i > 0 && <span className={`h-px w-6 ${i <= current ? "bg-ink" : "bg-rule"}`} aria-hidden="true" />}
                <span
                  aria-current={state === "now" ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-full px-2.5 py-1 ${
                    state === "now" ? "bg-ink text-sheet" : state === "done" ? "text-ink" : "text-faint"
                  }`}
                >
                  <span
                    className={`tabular grid size-[18px] place-items-center rounded-full text-[11px] font-semibold ${
                      state === "now" ? "bg-sheet text-ink" : state === "done" ? "bg-ink text-sheet" : "border border-rule"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </header>
  );
}
