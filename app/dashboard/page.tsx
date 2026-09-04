import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/db";
import {
  canonicalPlaylistTracks,
  canonicalPlaylists,
  musicConnections,
  playlistLinks,
  providerPlaylists,
  syncRuns,
  unmatchedTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ProviderToken, SyncStatus, Ago, CountBadge, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { AstryxLink } from "@/components/AstryxLink";
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
      const lastRun = (
        await db
          .select()
          .from(syncRuns)
          .where(eq(syncRuns.canonicalPlaylistId, c.id))
          .orderBy(desc(syncRuns.startedAt))
          .limit(1)
      )[0];
      return { c, links, trackCount: tracks.length, unmatchedCount: unmatched.length, lastRun };
    })
  );

  const stale = connections.filter((c) => c.needsReconnect);
  const failed = cards.filter(({ c }) => c.lastSyncStatus === "error");

  return (
    <VStack gap={6}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={1}>Dashboard</Heading>
        <Button label="New sync" variant="primary" href="/onboarding" as={Link} />
      </HStack>

      {stale.length > 0 && (
        <Banner
          status="warning"
          title="A connection needs attention"
          description={`${stale.map((c) => (c.provider === "spotify" ? "Spotify" : "Apple Music")).join(" and ")} expired. Sync is paused until you reconnect.`}
          endContent={<Button label="Reconnect" variant="secondary" size="sm" href="/settings/connections" as={Link} />}
        />
      )}

      {failed.length > 0 && (
        <Banner status="error" title={`${failed.length} sync${failed.length === 1 ? "" : "s"} failed`} collapsible={false}>
          <VStack gap={2}>
            {failed.map(({ c, lastRun }) => (
              <HStack key={c.id} hAlign="between" vAlign="center">
                <AstryxLink href={`/playlists/${c.id}`}>{c.name}</AstryxLink>
                <Text type="supporting" color="secondary">
                  {lastRun?.errorSummary ?? "Unknown error"}
                  {lastRun?.startedAt ? (
                    <>
                      {" · "}
                      <Ago date={lastRun.startedAt} />
                    </>
                  ) : null}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Banner>
      )}

      <VStack gap={3}>
        <Heading level={2}>Connections</Heading>
        <List hasDividers>
          {(["spotify", "apple"] as const).map((provider) => {
            const conn = connections.find((c) => c.provider === provider);
            const label = provider === "spotify" ? "Spotify" : "Apple Music";
            return (
              <ListItem
                key={provider}
                label={conn ? (conn.externalAccountName ?? label) : label}
                description={
                  conn
                    ? conn.needsReconnect
                      ? "Authorization expired"
                      : label
                    : `Connect ${label} to enable syncing`
                }
                startContent={<ProviderToken provider={provider} />}
                endContent={
                  <Button
                    label={conn ? (conn.needsReconnect ? "Reconnect" : "Manage") : "Connect"}
                    variant={conn?.needsReconnect ? "primary" : "secondary"}
                    size="sm"
                    href="/settings/connections"
                    as={Link}
                  />
                }
              />
            );
          })}
        </List>
      </VStack>

      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Heading level={2}>Synced playlists</Heading>
          <CountBadge count={cards.length} />
        </HStack>
        {cards.length === 0 ? (
          <EmptyState
            title="No synced playlists"
            body="Mirror a playlist, or link a Spotify and Apple Music pair."
            action={<Button label="Set up a sync" variant="primary" href="/onboarding" as={Link} />}
          />
        ) : (
          <VStack gap={3}>
            {cards.map(({ c, links, trackCount, unmatchedCount }) => {
              const spotifyLink = links.find((l) => l.provider === "spotify");
              const appleLink = links.find((l) => l.provider === "apple");
              return (
                <Card key={c.id}>
                  <VStack gap={4}>
                    <HStack hAlign="between" vAlign="start" wrap="wrap">
                      <VStack gap={1}>
                        <AstryxLink href={`/playlists/${c.id}`}>
                          <Heading level={3}>{c.name}</Heading>
                        </AstryxLink>
                        <Text type="supporting" color="secondary">
                          {trackCount} {trackCount === 1 ? "track" : "tracks"}
                          {unmatchedCount > 0 ? ` · ${unmatchedCount} unmatched` : ""} ·{" "}
                          {c.syncEnabled ? "On" : "Paused"} · <Ago date={c.lastSyncCompletedAt} />
                        </Text>
                      </VStack>
                      <SyncStatus status={c.lastSyncStatus} />
                    </HStack>

                    <List hasDividers>
                      <ListItem
                        label={spotifyLink?.name ?? "Spotify not linked"}
                        description={spotifyLink && !spotifyLink.editable ? "Read-only" : undefined}
                        startContent={<ProviderToken provider="spotify" />}
                      />
                      <ListItem
                        label={appleLink?.name ?? "Apple Music not linked"}
                        description={appleLink && !appleLink.editable ? "Read-only" : undefined}
                        startContent={<ProviderToken provider="apple" />}
                      />
                    </List>

                    <HStack gap={2} wrap="wrap">
                      <form action={syncNowAction}>
                        <input type="hidden" name="canonicalPlaylistId" value={c.id} />
                        <SubmitButton label="Sync now" pendingLabel="Syncing" />
                      </form>
                      <form action={toggleSyncAction}>
                        <input type="hidden" name="canonicalPlaylistId" value={c.id} />
                        <input type="hidden" name="enabled" value={c.syncEnabled ? "false" : "true"} />
                        <SubmitButton
                          label={c.syncEnabled ? "Pause" : "Resume"}
                          pendingLabel="Saving"
                          variant="ghost"
                        />
                      </form>
                      <Button label="Details" variant="ghost" href={`/playlists/${c.id}`} as={Link} />
                    </HStack>
                  </VStack>
                </Card>
              );
            })}
          </VStack>
        )}
      </VStack>
    </VStack>
  );
}
