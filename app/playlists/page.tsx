import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { canonicalPlaylists, playlistLinks, providerPlaylists } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ProviderToken, Ago, EmptyState } from "@/components/ui";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { refreshPlaylistsAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

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
    <VStack gap={6}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={1}>Playlists</Heading>
        <form action={refreshPlaylistsAction}>
          <SubmitButton label="Refresh" pendingLabel="Refreshing" />
        </form>
      </HStack>

      {rows.length === 0 && (
        <EmptyState
          title="Nothing here yet"
          body="Connect a service in Settings first."
          action={<Button label="Settings" variant="primary" href="/settings/connections" as={Link} />}
        />
      )}

      {sections.map(({ provider, title }) => {
        const list = rows.filter((r) => r.provider === provider);
        if (list.length === 0) return null;
        return (
          <VStack key={provider} gap={3}>
            <HStack gap={2} vAlign="center">
              <ProviderToken provider={provider} />
              <Heading level={2}>{title}</Heading>
            </HStack>
            <List hasDividers>
              {list.map((r) => {
                const canonicalId = linkedMap.get(r.id);
                return (
                  <ListItem
                    key={r.id}
                    label={r.name}
                    description={
                      <>
                        {r.provider === "apple" && r.trackCount === 0
                          ? "Count loads on first sync"
                          : `${r.trackCount} tracks`}{" "}
                        · Scanned <Ago date={r.lastScannedAt} />
                        {!r.editable ? " · Read-only" : ""}
                      </>
                    }
                    endContent={
                      canonicalId ? (
                        <Button label="View sync" variant="secondary" size="sm" href={`/playlists/${canonicalId}`} as={Link} />
                      ) : (
                        <Button label="Sync" variant="ghost" size="sm" href="/onboarding" as={Link} />
                      )
                    }
                  />
                );
              })}
            </List>
          </VStack>
        );
      })}
    </VStack>
  );
}
