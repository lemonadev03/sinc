"use client";

import { useMemo, useState } from "react";
import { createGroupAction, refreshPlaylistsAction, type ActionState } from "@/app/actions";
import { ProviderBadge } from "./ui";

export type PlaylistCardData = {
  rowId: string;
  provider: "spotify" | "apple";
  name: string;
  trackCount: number;
  editable: boolean;
  linked: boolean;
};

export function OnboardingPanel({ playlists, bothConnected }: { playlists: PlaylistCardData[]; bothConnected: boolean }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<"auto" | "mirror" | "pair">("auto");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spotify = useMemo(() => playlists.filter((p) => p.provider === "spotify"), [playlists]);
  const apple = useMemo(() => playlists.filter((p) => p.provider === "apple"), [playlists]);
  const selectedList = playlists.filter((p) => selected[p.rowId]);
  const selectedSpotify = selectedList.filter((p) => p.provider === "spotify");
  const selectedApple = selectedList.filter((p) => p.provider === "apple");

  function toggle(id: string) {
    setError(null);
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const effectiveMode =
    mode === "auto" ? (selectedList.length === 1 ? "mirror" : selectedList.length === 2 ? "pair" : "auto") : mode;

  async function submit() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("rowIds", selectedList.map((p) => p.rowId).join(","));
    fd.set("mode", selectedList.length === 1 ? "mirror" : "pair");
    const result = await createGroupAction({}, fd);
    setPending(false);
    if (result && typeof result === "object" && "error" in result && result.error) {
      setError(result.error);
    }
  }

  const canSubmit =
    pending ||
    (selectedList.length === 1 && bothConnected) ||
    (selectedSpotify.length === 1 && selectedApple.length === 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="card flex items-start gap-4 border-violet-900/50 bg-gradient-to-br from-violet-950/30 to-zinc-900/60">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-600/20 text-lg">🎧</span>
        <div>
          <p className="text-zinc-100">
            sup — here are ur playlists across Spotify + Apple Music. which ones do you want me to sync?
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            pick one to mirror it to the other service, or pick one from each to link them as the same
            playlist. everything stays additive — nothing gets deleted.
          </p>
        </div>
      </div>

      {!bothConnected && (
        <div className="card border-amber-800/50 bg-amber-950/20 text-sm text-amber-300">
          connect both Spotify and Apple Music in{" "}
          <a href="/settings/connections" className="underline">
            settings
          </a>{" "}
          to create mirror playlists.
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {playlists.length} playlist{playlists.length === 1 ? "" : "s"} indexed
        </p>
        <button type="button" className="btn-ghost" onClick={() => void refreshPlaylistsAction()}>
          ↻ Refresh index
        </button>
      </div>

      {spotify.length > 0 && <SectionTitle provider="Spotify" count={spotify.length} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {spotify.map((p) => (
          <PlaylistCard key={p.rowId} p={p} selected={!!selected[p.rowId]} onToggle={toggle} />
        ))}
      </div>

      {apple.length > 0 && <SectionTitle provider="Apple Music" count={apple.length} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {apple.map((p) => (
          <PlaylistCard key={p.rowId} p={p} selected={!!selected[p.rowId]} onToggle={toggle} />
        ))}
      </div>

      <div className="sticky bottom-4 card flex flex-wrap items-center justify-between gap-3 border-violet-900/50">
        <div className="text-sm">
          {selectedList.length === 0 && <span className="text-zinc-500">nothing selected yet</span>}
          {effectiveMode === "mirror" && selectedList.length === 1 && (
            <span className="text-zinc-300">
              mirror <b>{selectedList[0].name}</b> → {selectedList[0].provider === "spotify" ? "Apple Music" : "Spotify"}
            </span>
          )}
          {selectedSpotify.length === 1 && selectedApple.length === 1 && (
            <span className="text-zinc-300">
              link <b>{selectedSpotify[0].name}</b> ⇄ <b>{selectedApple[0].name}</b> as one playlist
            </span>
          )}
          {selectedList.length > 2 && <span className="text-amber-400">select at most two playlists</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
        <button type="button" className="btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
          {pending ? "setting up…" : "Sync it ⚡"}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ provider, count }: { provider: string; count: number }) {
  return (
    <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {provider} · {count}
    </p>
  );
}

function PlaylistCard({ p, selected, onToggle }: { p: PlaylistCardData; selected: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(p.rowId)}
      className={`card flex flex-col items-start gap-2 text-left transition-colors ${
        selected ? "border-violet-500 bg-violet-950/20" : "hover:border-zinc-700"
      } ${p.linked ? "opacity-50" : ""}`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <ProviderBadge provider={p.provider} />
        {p.linked ? (
          <span className="text-[11px] text-zinc-500">already syncing</span>
        ) : !p.editable ? (
          <span className="text-[11px] text-amber-500">read-only</span>
        ) : null}
      </div>
      <span className="font-medium text-zinc-100">{p.name}</span>
      <span className="text-xs text-zinc-500">
        {p.provider === "apple" && p.trackCount === 0 ? "count loads on first sync" : `${p.trackCount} tracks`}
      </span>
    </button>
  );
}
