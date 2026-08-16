import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { canonicalPlaylists, playlistLinks, providerPlaylists } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ProviderBadge, timeAgo, EmptyState } from "@/components/ui";
import { refreshPlaylistsAction } from "../actions";

export default async function PlaylistsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const rows = await db
    .select()
    .from(providerPlaylists)
    .where(and(eq(providerPlaylists.userId, user.id), isNull(providerPlaylists.archivedAt)))
    .orderBy(providerPlaylists.name);

  const linked = await db
    .select({ providerPlaylistId: playlistLinks.providerPlaylistId, canonicalId: playlistLinks.canonicalPlaylistId })
    .from(playlistLinks)
    .innerJoin(canonicalPlaylists, eq(canonicalPlaylists.id, playlistLinks.canonicalPlaylistId))
    .where(eq(canonicalPlaylists.userId, user.id));
  const linkedMap = new Map(linked.map((l) => [l.providerPlaylistId, l.canonicalId]));

  const sections: { provider: "spotify" | "apple"; title: string }[] = [
    { provider: "spotify", title: "Spotify" },
    { provider: "apple", title: "Apple Music" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">All playlists</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every indexed playlist per provider. Mirroring is opt-in — indexed ≠ synced.
          </p>
        </div>
        <form action={refreshPlaylistsAction}>
          <button type="submit" className="btn-secondary">
            ↻ Refresh from providers
          </button>
        </form>
      </div>

      {rows.length === 0 && (
        <EmptyState
          title="Nothing indexed yet"
          body="Connect a provider in settings — your playlists will be indexed automatically."
          action={
            <Link href="/settings/connections" className="btn-primary">
              Go to settings
            </Link>
          }
        />
      )}

      {sections.map(({ provider, title }) => {
        const list = rows.filter((r) => r.provider === provider);
        if (list.length === 0) return null;
        return (
          <section key={provider} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
              <ProviderBadge provider={provider} /> {title} · {list.length}
            </h2>
            <div className="card divide-y divide-zinc-800/70 p-0">
              {list.map((r) => {
                const canonicalId = linkedMap.get(r.id);
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-200">{r.name}</p>
                      <p className="text-xs text-zinc-500">
                        {r.trackCount} tracks · scanned {timeAgo(r.lastScannedAt)}
                        {!r.editable && <span className="text-amber-500"> · read-only</span>}
                      </p>
                    </div>
                    {canonicalId ? (
                      <Link href={`/playlists/${canonicalId}`} className="btn-secondary shrink-0">
                        syncing →
                      </Link>
                    ) : (
                      <Link href="/onboarding" className="btn-ghost shrink-0">
                        set up sync
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
