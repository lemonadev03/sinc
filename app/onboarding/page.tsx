import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections, playlistLinks, providerPlaylists } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { OnboardingPanel, type PlaylistCardData } from "@/components/OnboardingPanel";
import { EmptyState } from "@/components/ui";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const connections = await (await getDb())
    .select({ provider: musicConnections.provider })
    .from(musicConnections)
    .where(eq(musicConnections.userId, user.id));
  const connected = new Set(connections.map((c) => c.provider));

  const rows = await (await getDb())
    .select({
      rowId: providerPlaylists.id,
      provider: providerPlaylists.provider,
      name: providerPlaylists.name,
      trackCount: providerPlaylists.trackCount,
      editable: providerPlaylists.editable,
    })
    .from(providerPlaylists)
    .where(and(eq(providerPlaylists.userId, user.id), isNull(providerPlaylists.archivedAt)));

  const linkedRows = await (await getDb())
    .select({ providerPlaylistId: playlistLinks.providerPlaylistId })
    .from(playlistLinks);
  const linkedIds = new Set(linkedRows.map((l) => l.providerPlaylistId));

  // NOTE: playlist cards are rendered straight from provider inventory rows in our
  // own DB — no provider content is passed through any model.
  const playlists: PlaylistCardData[] = rows.map((r) => ({
    rowId: r.rowId,
    provider: r.provider as "spotify" | "apple",
    name: r.name,
    trackCount: r.trackCount,
    editable: r.editable,
    linked: linkedIds.has(r.rowId),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Set up a sync</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sync groups are opt-in. Everything else stays untouched.
        </p>
      </div>
      {playlists.length === 0 ? (
        <EmptyState
          title="No playlists indexed yet"
          body={
            connected.size === 0
              ? "Connect Spotify or Apple Music first — playlists get indexed automatically after connecting."
              : "Hit “Refresh index” after adding playlists on your providers, or reconnect on the settings page."
          }
        />
      ) : (
        <OnboardingPanel playlists={playlists} bothConnected={connected.has("spotify") && connected.has("apple")} />
      )}
    </div>
  );
}
