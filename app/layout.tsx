import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { FOOTER } from "@/lib/api";
import { SourceDrawerProvider } from "@/components/SourceDrawer";

export const metadata: Metadata = {
  title: "Structure Studio",
  description: "Compare four UK ownership structures for a packet of similar properties, with cited tax rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen pb-12">
        <SourceDrawerProvider>
          <header className="border-b border-slate-200">
            <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-3 px-6">
              <Link href="/" className="font-semibold tracking-tight">
                Structure <span className="text-accent">Studio</span>
              </Link>
              <span className="text-xs text-slate-400">UK property ownership structures, costed with cited rules</span>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
          <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 py-2 text-center text-xs text-slate-500 backdrop-blur">
            {FOOTER}
          </footer>
        </SourceDrawerProvider>
      </body>
    </html>
  );
}
