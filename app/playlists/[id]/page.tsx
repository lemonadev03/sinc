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
import { SubmitButton } from "@/components/SubmitButton";
import { SuggestBox } from "@/components/SuggestBox";
import {
  syncNowAction,
  toggleSyncAction,
  shareAction,
  detachFollowAction,
  suggestionDecisionAction,
  createMirrorAction,
} from "@/app/actions";
import { getFollowForOwnCanonical, listSuggestions } from "@/lib/sharing";
import { getAppUrl } from "@/lib/config";
import { musicConnections, playlistShares } from "@/db/schema";

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
    .select({
      id: unmatchedTracks.id,
      sourceProvider: unmatchedTracks.sourceProvider,
      reason: unmatchedTracks.reason,
      canonicalTrackId: unmatchedTracks.canonicalTrackId,
      displayLabel: unmatchedTracks.displayLabel,
      title: canonicalTracks.displayTitle,
      artist: canonicalTracks.displayArtist,
    })
    .from(unmatchedTracks)
    .leftJoin(canonicalTracks, eq(canonicalTracks.id, unmatchedTracks.canonicalTrackId))
    .where(and(eq(unmatchedTracks.canonicalPlaylistId, id), eq(unmatchedTracks.status, "open")))
    .orderBy(desc(unmatchedTracks.lastAttemptAt));

  // sharing state
  const follow = await getFollowForOwnCanonical(user.id, id);
  const suggestions = await listSuggestions(user.id, id);
  const share = (
    await db.select().from(playlistShares).where(eq(playlistShares.canonicalPlaylistId, id)).limit(1)
  )[0];
  const connections = await db
    .select({ provider: musicConnections.provider })
    .from(musicConnections)
    .where(eq(musicConnections.userId, user.id));
  const connectedProviders = new Set(connections.map((c) => c.provider));
  const linkedProviders = new Set(links.map((l) => l.provider));
  const pendingSuggestions = (suggestions ?? []).filter((s) => s.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">{canonical.name}</h1>
            <StatusPill status={canonical.lastSyncStatus} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {trackRows.length} tracks ·{" "}
            {canonical.syncEnabled ? "sync on" : "sync paused"} · synced {timeAgo(canonical.lastSyncCompletedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={syncNowAction}>
            <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
            <SubmitButton className="btn-primary" pendingLabel="Syncing…">
              ⟳ Sync now
            </SubmitButton>
          </form>
          <form action={toggleSyncAction}>
            <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
            <input type="hidden" name="enabled" value={canonical.syncEnabled ? "false" : "true"} />
            <SubmitButton className="btn-secondary" pendingLabel="…">
              {canonical.syncEnabled ? "Pause" : "Resume"}
            </SubmitButton>
          </form>
        </div>
      </div>

      {unmatched.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">
            Can&apos;t sync {unmatched.length} song{unmatched.length === 1 ? "" : "s"}
          </h2>
          <p className="-mt-1 text-xs text-zinc-500">
            these weren&apos;t found on the other service — they stay safe here, we retry automatically.
          </p>
          <div className="card divide-y divide-zinc-800/70 p-0">
            {unmatched.map((u) => {
              const label = u.title ? `${u.title} — ${u.artist}` : u.displayLabel ?? "Unknown track";
              return (
                <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-200">
                      <ProviderBadge provider={u.sourceProvider} /> {label}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-500/90">{friendlyReason(u.reason)}</p>
                  </div>
                  <form action={syncNowAction}>
                    <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                    <SubmitButton className="btn-secondary shrink-0 text-xs" pendingLabel="Retrying…">
                      Retry match
                    </SubmitButton>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
        {(["spotify", "apple"] as const)
          .filter((p) => !linkedProviders.has(p) && connectedProviders.has(p))
          .map((p) => (
            <form key={p} action={createMirrorAction} className="card flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <ProviderBadge provider={p} />
                no {p === "spotify" ? "Spotify" : "Apple Music"} playlist yet
              </div>
              <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
              <input type="hidden" name="provider" value={p} />
              <SubmitButton className="btn-secondary shrink-0 text-xs" pendingLabel="creating…">
                + create mirror
              </SubmitButton>
            </form>
          ))}
      </div>

      {follow && (
        <section className="card flex flex-wrap items-center justify-between gap-3 border-violet-900/50 bg-violet-950/10">
          <div>
            <p className="text-sm text-zinc-200">
              {follow.detachedAt ? "detached from" : "following"}{" "}
              <span className="font-semibold text-violet-300">{follow.ownerEmail}</span>&apos;s playlist
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {follow.detachedAt
                ? "your copy is now independent — new songs from the owner no longer flow in."
                : "new songs the owner adds flow into this playlist on each sync."}
            </p>
          </div>
          {!follow.detachedAt && (
            <form action={detachFollowAction}>
              <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
              <SubmitButton className="btn-secondary" pendingLabel="detaching…">
                Detach
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      {follow && !follow.detachedAt && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Suggest a song back</h2>
          <p className="-mt-1 text-xs text-zinc-500">your suggestion goes to {follow.ownerEmail} to accept or dismiss.</p>
          <SuggestBox canonicalPlaylistId={canonical.id} />
        </section>
      )}

      {pendingSuggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Suggestions for you ({pendingSuggestions.length})</h2>
          <div className="card divide-y divide-zinc-800/70 p-0">
            {pendingSuggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">
                    {s.title} <span className="text-zinc-500">— {s.artist}</span>
                  </p>
                  <p className="text-xs text-zinc-500">suggested by {s.suggesterEmail}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <form action={suggestionDecisionAction}>
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <SubmitButton className="btn-primary text-xs" pendingLabel="adding…">
                      ✓ Accept
                    </SubmitButton>
                  </form>
                  <form action={suggestionDecisionAction}>
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                    <input type="hidden" name="decision" value="dismiss" />
                    <SubmitButton className="btn-ghost text-xs" pendingLabel="…">
                      Dismiss
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">Share this playlist</p>
          {share && !share.revokedAt ? (
            <>
              <p className="mt-1 break-all font-mono text-xs text-violet-300">{getAppUrl()}/shared/{share.slug}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                anyone with a sinc account can follow or import · mirrors they create carry a
                &ldquo;created and managed by sinc&rdquo; note
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">generate a link to let friends follow or import this playlist.</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {share && !share.revokedAt ? (
            <>
              <form action={shareAction}>
                <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                <input type="hidden" name="revoke" value="true" />
                <SubmitButton className="btn-ghost" pendingLabel="…">
                  Stop sharing
                </SubmitButton>
              </form>
            </>
          ) : (
            <form action={shareAction}>
              <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
              <SubmitButton className="btn-primary" pendingLabel="creating…">
                Create share link
              </SubmitButton>
            </form>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">Tracks</h2>
        <div className="card divide-y divide-zinc-800/70 p-0">
          {trackRows.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">No tracks yet.</p>}
          {trackRows.map((t) => {
            const m = mappingMap.get(t.canonicalTrackId) ?? {};
            return (
              <div key={t.canonicalTrackId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">
                    <span className="mr-2 text-xs text-zinc-600">{t.position}</span>
                    {t.title}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{t.artist}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                  <ProviderBadge provider="spotify" />
                  <span className={m.spotify ? "text-emerald-400" : "text-zinc-600"}>{m.spotify ? "✓" : "—"}</span>
                  <ProviderBadge provider="apple" />
                  <span className={m.apple ? "text-emerald-400" : "text-zinc-600"}>{m.apple ? "✓" : "—"}</span>
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

function friendlyReason(raw: string): string {
  if (raw.startsWith("local file")) return "local file — lives only on that device, can't be synced";
  if (raw.includes("no match on apple")) return "not available on Apple Music";
  if (raw.includes("no match on spotify")) return "not available on Spotify";
  if (raw.includes("no confident metadata match")) return "couldn't be matched confidently";
  if (raw.includes("missing title/artist")) return "missing title or artist";
  return raw.replace(/\[\w+\]\s*/g, "");
}
