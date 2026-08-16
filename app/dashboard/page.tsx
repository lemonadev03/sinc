import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import {
  canonicalPlaylistTracks,
  canonicalPlaylists,
  musicConnections,
  playlistLinks,
  providerPlaylists,
  unmatchedTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ProviderBadge, StatusPill, timeAgo, EmptyState } from "@/components/ui";
import { syncNowAction, toggleSyncAction } from "../actions";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const connections = await db.select().from(musicConnections).where(eq(musicConnections.userId, user.id));
  const canonicals = await db.select().from(canonicalPlaylists).where(eq(canonicalPlaylists.userId, user.id));

  const cards = await Promise.all(
    canonicals.map(async (c) => {
      const links = await db
        .select({
          provider: providerPlaylists.provider,
          name: providerPlaylists.name,
          editable: providerPlaylists.editable,
          archivedAt: providerPlaylists.archivedAt,
        })
        .from(playlistLinks)
        .innerJoin(providerPlaylists, eq(providerPlaylists.id, playlistLinks.providerPlaylistId))
        .where(eq(playlistLinks.canonicalPlaylistId, c.id));
      const tracks = await db
        .select({ id: canonicalPlaylistTracks.canonicalTrackId })
        .from(canonicalPlaylistTracks)
        .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, c.id));
      const unmatched = await db
        .select({ id: unmatchedTracks.id })
        .from(unmatchedTracks)
        .where(and(eq(unmatchedTracks.canonicalPlaylistId, c.id), eq(unmatchedTracks.status, "open")));
      return { c, links, trackCount: tracks.length, unmatchedCount: unmatched.length };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">Additive sync runs every 10 minutes for enabled playlists.</p>
        </div>
        <Link href="/onboarding" className="btn-primary">
          + New sync
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(["spotify", "apple"] as const).map((provider) => {
          const conn = connections.find((c) => c.provider === provider);
          const label = provider === "spotify" ? "Spotify" : "Apple Music";
          return (
            <div key={provider} className="card flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ProviderBadge provider={provider} />
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    {conn ? `Connected${conn.externalAccountName ? ` · ${conn.externalAccountName}` : ""}` : "Not connected"}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {conn
                      ? conn.needsReconnect
                        ? "needs reconnection"
                        : `validated ${timeAgo(conn.lastValidatedAt)}`
                      : `connect ${label} to enable syncing`}
                  </p>
                </div>
              </div>
              <Link href="/settings/connections" className={conn?.needsReconnect ? "btn-primary" : "btn-secondary"}>
                {conn ? (conn.needsReconnect ? "Reconnect" : "Manage") : "Connect"}
              </Link>
            </div>
          );
        })}
      </div>

      <h2 className="text-lg font-semibold text-zinc-100">Canonical playlists</h2>
      {cards.length === 0 ? (
        <EmptyState
          title="No sync groups yet"
          body="Create one from the onboarding panel — pick a playlist to mirror, or link an existing pair."
          action={
            <Link href="/onboarding" className="btn-primary">
              Set up a sync
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map(({ c, links, trackCount, unmatchedCount }) => {
            const spotifyLink = links.find((l) => l.provider === "spotify");
            const appleLink = links.find((l) => l.provider === "apple");
            const spotifyConn = connections.find((x) => x.provider === "spotify");
            const appleConn = connections.find((x) => x.provider === "apple");
            return (
              <div key={c.id} className="card flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/playlists/${c.id}`} className="text-lg font-semibold text-zinc-100 hover:text-violet-300">
                      {c.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {trackCount} tracks · {unmatchedCount > 0 ? `${unmatchedCount} unmatched · ` : ""}
                      {c.syncEnabled ? "sync on" : "sync paused"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={c.lastSyncStatus} />
                    <span className="text-xs text-zinc-500">synced {timeAgo(c.lastSyncCompletedAt)}</span>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <LinkRow
                    badge="spotify"
                    name={spotifyLink?.name ?? (spotifyConn ? "not linked" : "Spotify not connected")}
                    broken={spotifyLink ? !spotifyLink.editable || spotifyLink.archivedAt !== null : spotifyConn ? false : true}
                  />
                  <LinkRow
                    badge="apple"
                    name={appleLink?.name ?? (appleConn ? "not linked" : "Apple Music not connected")}
                    broken={appleLink ? !appleLink.editable || appleLink.archivedAt !== null : appleConn ? false : true}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={syncNowAction}>
                    <input type="hidden" name="canonicalPlaylistId" value={c.id} />
                    <button type="submit" className="btn-secondary">
                      ⟳ Sync now
                    </button>
                  </form>
                  <form action={toggleSyncAction}>
                    <input type="hidden" name="canonicalPlaylistId" value={c.id} />
                    <input type="hidden" name="enabled" value={c.syncEnabled ? "false" : "true"} />
                    <button type="submit" className="btn-ghost">
                      {c.syncEnabled ? "Pause sync" : "Resume sync"}
                    </button>
                  </form>
                  <Link href={`/playlists/${c.id}`} className="btn-ghost">
                    Details →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkRow({ badge, name, broken }: { badge: string; name: string; broken: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <ProviderBadge provider={badge} />
      <span className={`truncate text-sm ${broken ? "text-amber-400" : "text-zinc-300"}`}>
        {name}
        {broken ? " ⚠" : ""}
      </span>
    </div>
  );
}
