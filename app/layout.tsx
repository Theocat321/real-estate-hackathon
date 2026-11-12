import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { FOOTER } from "@/lib/api";
import { SourceDrawerProvider } from "@/components/SourceDrawer";
import { SiteHeader } from "@/components/SiteHeader";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Structure Studio",
  description: "Compare four UK ownership structures for a packet of similar properties, with cited tax rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const footerParts = FOOTER.split(" · ");
  return (
    <html lang="en-GB" className={archivo.variable}>
      <body className="min-h-screen pb-10">
        <SourceDrawerProvider>
          <SiteHeader />
          <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
          <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper/95 backdrop-blur">
            <ul className="mx-auto flex h-8 max-w-[1400px] items-center gap-5 px-6 text-[11px] text-muted">
              {footerParts.map((p, i) => (
                <li key={p} className={i === footerParts.length - 1 ? "ml-auto font-medium text-ink-soft" : ""}>
                  {p}
                </li>
              ))}
            </ul>
          </footer>
        </SourceDrawerProvider>
      </body>
    </html>
  );
}
