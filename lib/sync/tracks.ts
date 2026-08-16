import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { canonicalPlaylistTracks, canonicalTracks, trackMappings } from "@/db/schema";
import type { Provider, ProviderTrack } from "../providers/types";
import { dedupeKey } from "../normalize";

/** Upsert a provider track into the canonical track universe + playlist membership. */
export async function ingestProviderTrack(
  db: AppDb,
  userId: string,
  canonicalPlaylistId: string,
  provider: Provider,
  item: ProviderTrack
): Promise<{ inserted: boolean; canonicalTrackId: string }> {
  const key = dedupeKey({ isrc: item.isrc, title: item.title, artist: item.artist });

  let trackRow = (
    await db
      .select()
      .from(canonicalTracks)
      .where(and(eq(canonicalTracks.userId, userId), eq(canonicalTracks.dedupeKey, key)))
      .limit(1)
  )[0];

  if (!trackRow) {
    const id = crypto.randomUUID();
    await db.insert(canonicalTracks).values({
      id,
      userId,
      isrc: item.isrc,
      normalizedTitle: item.title.toLowerCase(),
      normalizedArtist: item.artist.toLowerCase(),
      displayTitle: item.title,
      displayArtist: item.artist,
      durationMs: item.durationMs,
      dedupeKey: key,
    });
    trackRow = { id } as typeof trackRow;
  } else if (!trackRow.isrc && item.isrc) {
    // learned an ISRC after first seeing the track by metadata
    await db.update(canonicalTracks).set({ isrc: item.isrc }).where(eq(canonicalTracks.id, trackRow.id));
  }

  const existingMembership = (
    await db
      .select()
      .from(canonicalPlaylistTracks)
      .where(
        and(
          eq(canonicalPlaylistTracks.canonicalPlaylistId, canonicalPlaylistId),
          eq(canonicalPlaylistTracks.canonicalTrackId, trackRow.id)
        )
      )
      .limit(1)
  )[0];

  let inserted = false;
  if (!existingMembership) {
    const count = await db
      .select({ id: canonicalPlaylistTracks.canonicalTrackId })
      .from(canonicalPlaylistTracks)
      .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, canonicalPlaylistId));
    await db.insert(canonicalPlaylistTracks).values({
      canonicalPlaylistId,
      canonicalTrackId: trackRow.id,
      position: count.length + 1,
      firstSeenProvider: provider,
    });
    inserted = true;
  }

  // The provider we ingested from always yields a direct (trusted) mapping.
  const existingMapping = (
    await db
      .select()
      .from(trackMappings)
      .where(and(eq(trackMappings.canonicalTrackId, trackRow.id), eq(trackMappings.provider, provider)))
      .limit(1)
  )[0];
  if (!existingMapping) {
    await db.insert(trackMappings).values({
      id: crypto.randomUUID(),
      canonicalTrackId: trackRow.id,
      provider,
      providerTrackId: item.providerTrackId,
      providerUri: item.providerUri,
      matchMethod: item.isrc ? "isrc" : "metadata",
      confidence: 100,
    });
  }

  return { inserted, canonicalTrackId: trackRow.id };
}

export async function upsertTrackMapping(
  db: AppDb,
  canonicalTrackId: string,
  provider: Provider,
  providerTrackId: string,
  providerUri: string | null,
  matchMethod: "existing" | "isrc" | "metadata" | "manual",
  confidence: number
): Promise<void> {
  const existing = (
    await db
      .select()
      .from(trackMappings)
      .where(and(eq(trackMappings.canonicalTrackId, canonicalTrackId), eq(trackMappings.provider, provider)))
      .limit(1)
  )[0];
  if (existing) {
    if (existing.providerTrackId !== providerTrackId) {
      await db
        .update(trackMappings)
        .set({ providerTrackId, providerUri, matchMethod, confidence })
        .where(eq(trackMappings.id, existing.id));
    }
    return;
  }
  await db.insert(trackMappings).values({
    id: crypto.randomUUID(),
    canonicalTrackId,
    provider,
    providerTrackId,
    providerUri,
    matchMethod,
    confidence,
  });
}
