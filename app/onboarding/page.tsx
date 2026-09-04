import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections, playlistLinks, providerPlaylists } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { OnboardingPanel, type PlaylistCardData } from "@/components/OnboardingPanel";
import { EmptyState } from "@/components/ui";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/VStack";

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
    <VStack gap={5}>
      <Heading level={1}>New sync</Heading>
      {playlists.length === 0 ? (
        <EmptyState
          title="No playlists found"
          body={
            connected.size === 0
              ? "Connect a service first — playlists appear here automatically."
              : "Add playlists on your connected services, then refresh."
          }
        />
      ) : (
        <OnboardingPanel playlists={playlists} bothConnected={connected.has("spotify") && connected.has("apple")} />
      )}
    </VStack>
  );
}
