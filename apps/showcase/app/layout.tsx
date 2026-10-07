import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@repo/ui/styles.css";

export const metadata: Metadata = {
  title: "Ryan McGee — Senior Full-Stack Software Engineer",
  description:
    "I build real-time systems, data-heavy dashboards, and infrastructure tooling — engineered, tested, and live.",
};

const GITHUB = "https://github.com/rjmcgee53192-prog";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Astra", href: "/demos/astra" },
  { label: "Volt", href: "/demos/volt" },
  { label: "TensorGrid", href: "/demos/tensorgrid" },
  { label: "Pulse", href: "/demos/pulse" },
  { label: "TraceLens", href: "/demos/tracelens" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#0a0e14]/90 backdrop-blur">
          <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <a href="/" className="font-bold tracking-tight text-slate-100">
              ryan<span className="text-blue-400">.</span>builds
            </a>
            <div className="flex items-center gap-1 sm:gap-2">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-2.5 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="border-t border-slate-800">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 sm:flex-row">
            <p className="text-sm text-slate-500">
              © 2026 Ryan McGee — built with Next.js, TypeScript, and a strict
              monorepo.
            </p>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-slate-400 transition-colors hover:text-blue-400"
            >
              github.com/rjmcgee53192-prog
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
