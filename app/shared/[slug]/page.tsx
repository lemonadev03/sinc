import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { canonicalPlaylistTracks, canonicalTracks } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getShareBySlug } from "@/lib/sharing";
import { importSharedAction } from "@/app/actions";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { AstryxLink } from "@/components/AstryxLink";
import { SubmitButton } from "@/components/SubmitButton";

export default async function SharedPlaylistPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const share = await getShareBySlug(slug);
  if (!share || share.revokedAt) notFound();

  const viewer = await getSessionUser();
  const isOwner = viewer?.id === share.ownerId;

  const tracks = await (await getDb())
    .select({
      position: canonicalPlaylistTracks.position,
      title: canonicalTracks.displayTitle,
      artist: canonicalTracks.displayArtist,
      isrc: canonicalTracks.isrc,
    })
    .from(canonicalPlaylistTracks)
    .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
    .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, share.canonicalId))
    .orderBy(canonicalPlaylistTracks.position);

  return (
    <VStack gap={5}>
      <Card>
        <VStack gap={3}>
          <VStack gap={1}>
            <Heading level={1}>{share.name}</Heading>
            <Text color="secondary">
              By {share.ownerEmail} · {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            </Text>
          </VStack>
          {error && <Text>{error}</Text>}
          {viewer && !isOwner ? (
            <HStack gap={2}>
              <form action={importSharedAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="follow" value="true" />
                <SubmitButton label="Follow" pendingLabel="Following" variant="primary" />
              </form>
              <form action={importSharedAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="follow" value="false" />
                <SubmitButton label="Import once" pendingLabel="Importing" />
              </form>
            </HStack>
          ) : isOwner ? (
            <Text color="secondary">This is your share link.</Text>
          ) : (
            <Text color="secondary">
              <AstryxLink href="/signup">Create an account</AstryxLink> to follow or import.
            </Text>
          )}
        </VStack>
      </Card>

      <List hasDividers>
        {tracks.map((t) => (
          <ListItem
            key={t.position}
            label={t.title}
            description={t.artist}
            startContent={
              <Text type="supporting" color="secondary">
                {t.position}
              </Text>
            }
          />
        ))}
      </List>
    </VStack>
  );
}
