import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  canonicalPlaylistTracks,
  canonicalPlaylists,
  canonicalTracks,
  playlistLinks,
  providerPlaylists,
  syncRuns,
  trackMappings,
  unmatchedTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ProviderBadge, StatusPill, timeAgo } from "@/components/ui";
import { syncNowAction, toggleSyncAction } from "@/app/actions";

export default async function CanonicalPlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const db = await getDb();
  const canonical = (
    await db
      .select()
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, id), eq(canonicalPlaylists.userId, user.id)))
      .limit(1)
  )[0];
  if (!canonical) notFound();

  const links = await db
    .select({
      provider: providerPlaylists.provider,
      name: providerPlaylists.name,
      externalUrl: providerPlaylists.externalUrl,
      providerPlaylistId: providerPlaylists.providerPlaylistId,
      editable: providerPlaylists.editable,
      archivedAt: providerPlaylists.archivedAt,
    })
    .from(playlistLinks)
    .innerJoin(providerPlaylists, eq(providerPlaylists.id, playlistLinks.providerPlaylistId))
    .where(eq(playlistLinks.canonicalPlaylistId, id));

  const trackRows = await db
    .select({
      canonicalTrackId: canonicalPlaylistTracks.canonicalTrackId,
      position: canonicalPlaylistTracks.position,
      firstSeenProvider: canonicalPlaylistTracks.firstSeenProvider,
      title: canonicalTracks.displayTitle,
      artist: canonicalTracks.displayArtist,
      isrc: canonicalTracks.isrc,
      dedupeKey: canonicalTracks.dedupeKey,
    })
    .from(canonicalPlaylistTracks)
    .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
    .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, id))
    .orderBy(canonicalPlaylistTracks.position);

  const mappings = trackRows.length
    ? await db
        .select()
        .from(trackMappings)
        .where(inArray(trackMappings.canonicalTrackId, trackRows.map((t) => t.canonicalTrackId)))
    : [];
  const mappingMap = new Map<string, { spotify?: string; apple?: string }>();
  for (const m of mappings) {
    const entry = mappingMap.get(m.canonicalTrackId) ?? {};
    entry[m.provider as "spotify" | "apple"] = m.matchMethod;
    mappingMap.set(m.canonicalTrackId, entry);
  }

  const runs = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.canonicalPlaylistId, id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(10);

  const unmatched = await db
    .select()
    .from(unmatchedTracks)
    .where(and(eq(unmatchedTracks.canonicalPlaylistId, id), eq(unmatchedTracks.status, "open")))
    .orderBy(desc(unmatchedTracks.lastAttemptAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">{canonical.name}</h1>
            <StatusPill status={canonical.lastSyncStatus} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            canonical playlist · {trackRows.length} tracks · mode {canonical.syncMode} ·{" "}
            {canonical.syncEnabled ? "sync on" : "sync paused"} · synced {timeAgo(canonical.lastSyncCompletedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={syncNowAction}>
            <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
            <button type="submit" className="btn-primary">
              ⟳ Sync now
            </button>
          </form>
          <form action={toggleSyncAction}>
            <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
            <input type="hidden" name="enabled" value={canonical.syncEnabled ? "false" : "true"} />
            <button type="submit" className="btn-secondary">
              {canonical.syncEnabled ? "Pause" : "Resume"}
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {links.map((l) => (
          <div key={l.providerPlaylistId} className="card flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <ProviderBadge provider={l.provider} />
              <span className="truncate text-sm text-zinc-200">{l.name}</span>
            </div>
            {l.externalUrl ? (
              <a href={l.externalUrl} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 text-xs">
                open ↗
              </a>
            ) : null}
          </div>
        ))}
      </div>

      {unmatched.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Unmatched tracks ({unmatched.length})</h2>
          <div className="card divide-y divide-zinc-800/70 p-0">
            {unmatched.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-300">
                    <ProviderBadge provider={u.sourceProvider} /> {u.sourceTrackId}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-500/90">{u.reason}</p>
                </div>
                <form action={syncNowAction}>
                  <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                  <button type="submit" className="btn-secondary shrink-0 text-xs">
                    Retry match
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">Tracks (canonical order)</h2>
        <div className="card divide-y divide-zinc-800/70 p-0">
          {trackRows.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">No tracks ingested yet.</p>}
          {trackRows.map((t) => {
            const m = mappingMap.get(t.canonicalTrackId) ?? {};
            return (
              <div key={t.canonicalTrackId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">
                    <span className="mr-2 text-xs text-zinc-600">{t.position}</span>
                    {t.title}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {t.artist}
                    {t.isrc ? ` · ISRC ${t.isrc}` : " · no ISRC"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                  <ProviderBadge provider="spotify" />
                  <span className={m.spotify ? "text-emerald-400" : "text-zinc-600"}>{m.spotify ?? "—"}</span>
                  <ProviderBadge provider="apple" />
                  <span className={m.apple ? "text-emerald-400" : "text-zinc-600"}>{m.apple ?? "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">Recent sync runs</h2>
        <div className="card divide-y divide-zinc-800/70 p-0">
          {runs.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">No runs yet.</p>}
          {runs.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <StatusPill status={r.status} />
                <span className="text-xs text-zinc-500">
                  {r.trigger} · {timeAgo(r.startedAt)}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                +{r.ingestedCount} ingested · +{r.spotifyAddedCount} spotify · +{r.appleAddedCount} apple ·{" "}
                {r.unmatchedCount} unmatched
                {r.errorSummary ? ` · ${r.errorSummary}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-zinc-600">
        Additive-only: removing a track from a provider never removes it from the canonical playlist in v1.{" "}
        <Link href="/privacy" className="underline">
          Privacy
        </Link>
      </p>
    </div>
  );
}
