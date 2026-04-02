import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sports-Bet | NBA Prop Analyzer",
  description: "Automated NBA player prop value finder for PrizePicks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans">
        {/* Nav */}
        <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight">
                <span className="text-emerald-400">Sports</span>
                <span className="text-white">-Bet</span>
              </span>
              <span className="text-xs font-mono text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
                NBA
              </span>
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/history"
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                History
              </Link>
            </div>
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1">{children}</main>

        {/* Footer */}
        <footer className="border-t border-zinc-800 py-4">
          <div className="max-w-6xl mx-auto px-4 flex items-center justify-between text-xs text-zinc-600">
            <span>Sports-Bet v0.1.0</span>
            <span>Data from balldontlie.io</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
