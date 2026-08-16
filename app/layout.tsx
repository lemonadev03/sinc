import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSessionUser } from "@/lib/auth";
import { Logo } from "@/components/ui";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "playlist-sync — Spotify ⇄ Apple Music",
  description: "Keep your Spotify and Apple Music playlists in additive sync, with a canonical source of truth.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Logo />
            <nav className="flex items-center gap-1 text-sm">
              {user ? (
                <>
                  <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100">
                    Dashboard
                  </Link>
                  <Link href="/playlists" className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100">
                    Playlists
                  </Link>
                  <Link href="/onboarding" className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100">
                    New sync
                  </Link>
                  <Link href="/settings/connections" className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100">
                    Settings
                  </Link>
                  <form action={logoutAction}>
                    <button type="submit" className="rounded-lg px-3 py-1.5 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100">
                      Log out
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100">
                    Log in
                  </Link>
                  <Link href="/signup" className="btn-primary">
                    Get started
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-zinc-600">
          <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4">
            <span>Additive two-way sync · canonical source of truth · v1</span>
            <Link href="/privacy" className="hover:text-zinc-400">
              Privacy
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
