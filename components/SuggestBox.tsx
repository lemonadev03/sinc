"use client";

import { useState } from "react";
import { suggestTrackAction } from "@/app/actions";

type SearchResult = {
  provider: string;
  providerTrackId: string;
  isrc: string | null;
  title: string;
  artist: string;
  durationMs: number | null;
};

export function SuggestBox({ canonicalPlaylistId }: { canonicalPlaylistId: string }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function search() {
    if (term.trim().length < 2) return;
    setLoading(true);
    setSent(null);
    try {
      const res = await fetch(`/api/tracks/search?term=${encodeURIComponent(term)}`);
      const json = (await res.json()) as { results: SearchResult[] };
      setResults(json.results ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function suggest(r: SearchResult) {
    const fd = new FormData();
    fd.set("canonicalPlaylistId", canonicalPlaylistId);
    fd.set("title", r.title);
    fd.set("artist", r.artist);
    fd.set("isrc", r.isrc ?? "");
    fd.set("durationMs", String(r.durationMs ?? ""));
    fd.set("provider", r.provider);
    fd.set("providerTrackId", r.providerTrackId);
    await suggestTrackAction(fd);
    setSent(`${r.title} — suggested to the owner ✓`);
    setResults([]);
    setTerm("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="search a song to suggest…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={() => void search()} disabled={loading}>
          {loading ? "…" : "Search"}
        </button>
      </div>
      {sent && <p className="text-sm text-emerald-400">{sent}</p>}
      {results.length > 0 && (
        <div className="card divide-y divide-zinc-800/70 p-0">
          {results.map((r) => (
            <button
              key={`${r.provider}:${r.providerTrackId}`}
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-zinc-800/40"
              onClick={() => void suggest(r)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-200">{r.title}</p>
                <p className="truncate text-xs text-zinc-500">{r.artist}</p>
              </div>
              <span className="shrink-0 text-[11px] uppercase text-zinc-500">{r.provider} · suggest ↗</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
