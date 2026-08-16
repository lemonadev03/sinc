import Link from "next/link";
import type { ReactNode } from "react";

export function ProviderBadge({ provider }: { provider: string }) {
  const isSpotify = provider === "spotify";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        isSpotify ? "bg-[#1DB954]/15 text-[#1DB954]" : "bg-[#FA2D48]/15 text-[#FA2D48]"
      }`}
    >
      {isSpotify ? "Spotify" : "Apple Music"}
    </span>
  );
}

export function StatusPill({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-400",
    running: "bg-amber-500/15 text-amber-400",
    partial: "bg-amber-500/15 text-amber-400",
    error: "bg-red-500/15 text-red-400",
  };
  const cls = status ? map[status] ?? "bg-zinc-700/40 text-zinc-400" : "bg-zinc-700/40 text-zinc-400";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{status ?? "never"}</span>;
}

export function timeAgo(date: Date | null | undefined): string {
  if (!date) return "never";
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-base font-semibold text-zinc-200">{title}</p>
      <p className="max-w-md text-sm text-zinc-500">{body}</p>
      {action}
    </div>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-100">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#1DB954] to-[#FA2D48] text-xs font-black text-black">
        ⇄
      </span>
      playlist-sync
    </Link>
  );
}
