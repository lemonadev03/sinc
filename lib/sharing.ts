import { and, eq, isNull, desc } from "drizzle-orm";
import { getDb } from "@/db";
import type { AppDb } from "@/db";
import {
  canonicalPlaylists,
  canonicalPlaylistTracks,
  canonicalTracks,
  playlistFollows,
  playlistShares,
  trackMappings,
  trackSuggestions,
  users,
} from "@/db/schema";
import { randomToken } from "./crypto";
import { ingestProviderTrack } from "./sync/tracks";
import type { Provider } from "./providers/types";

/** Shown on provider-created mirror playlists. No personal data leaves the app. */
export const MIRROR_DESCRIPTION = "Created and managed by sinc · https://sinc.lesmonsaluta.com";

// --- sharing ---

export async function createOrGetShare(userId: string, canonicalPlaylistId: string) {
  const db = await getDb();
  const owned = (
    await db
      .select({ id: canonicalPlaylists.id, name: canonicalPlaylists.name })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, canonicalPlaylistId), eq(canonicalPlaylists.userId, userId)))
      .limit(1)
  )[0];
  if (!owned) return { ok: false as const, error: "Playlist not found for this account." };

  const existing = (
    await db
      .select()
      .from(playlistShares)
      .where(eq(playlistShares.canonicalPlaylistId, canonicalPlaylistId))
      .limit(1)
  )[0];
  if (existing && !existing.revokedAt) return { ok: true as const, slug: existing.slug, name: owned.name };

  const slug = randomToken(9); // unguessable share id
  if (existing) {
    await db
      .update(playlistShares)
      .set({ slug, revokedAt: null, createdAt: new Date() })
      .where(eq(playlistShares.id, existing.id));
  } else {
    await db.insert(playlistShares).values({
      id: crypto.randomUUID(),
      canonicalPlaylistId,
      createdByUserId: userId,
      slug,
    });
  }
  return { ok: true as const, slug, name: owned.name };
}

export async function revokeShare(userId: string, canonicalPlaylistId: string) {
  const db = await getDb();
  await db
    .update(playlistShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(playlistShares.canonicalPlaylistId, canonicalPlaylistId),
        eq(playlistShares.createdByUserId, userId),
        isNull(playlistShares.revokedAt)
      )
    );
}

export async function getShareBySlug(slug: string) {
  const db = await getDb();
  const row = (
    await db
      .select({
        slug: playlistShares.slug,
        revokedAt: playlistShares.revokedAt,
        canonicalId: canonicalPlaylists.id,
        name: canonicalPlaylists.name,
        ownerId: users.id,
        ownerEmail: users.email,
      })
      .from(playlistShares)
      .innerJoin(canonicalPlaylists, eq(canonicalPlaylists.id, playlistShares.canonicalPlaylistId))
      .innerJoin(users, eq(users.id, playlistShares.createdByUserId))
      .where(eq(playlistShares.slug, slug))
      .limit(1)
  )[0];
  return row ?? null;
}

// --- track copying (shared by import + follow propagation) ---

/**
 * Copies canonical tracks (with their resolved provider mappings) from a source
 * canonical playlist into a target user's canonical playlist. Returns how many
 * memberships were newly added. Mappings carry over, so followers rarely need
 * fresh provider searches.
 */
export async function copyCanonicalTracks(
  db: AppDb,
  sourceCanonicalId: string,
  targetUserId: string,
  targetCanonicalId: string
): Promise<number> {
  const sourceRows = await db
    .select({
      position: canonicalPlaylistTracks.position,
      firstSeenProvider: canonicalPlaylistTracks.firstSeenProvider,
      trackId: canonicalTracks.id,
      isrc: canonicalTracks.isrc,
      normalizedTitle: canonicalTracks.normalizedTitle,
      normalizedArtist: canonicalTracks.normalizedArtist,
      displayTitle: canonicalTracks.displayTitle,
      displayArtist: canonicalTracks.displayArtist,
      durationMs: canonicalTracks.durationMs,
      dedupeKey: canonicalTracks.dedupeKey,
    })
    .from(canonicalPlaylistTracks)
    .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
    .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, sourceCanonicalId))
    .orderBy(canonicalPlaylistTracks.position);

  let added = 0;
  for (const row of sourceRows) {
    // find-or-create in the target user's track universe
    let target = (
      await db
        .select({ id: canonicalTracks.id })
        .from(canonicalTracks)
        .where(and(eq(canonicalTracks.userId, targetUserId), eq(canonicalTracks.dedupeKey, row.dedupeKey)))
        .limit(1)
    )[0];

    if (!target) {
      const id = crypto.randomUUID();
      await db.insert(canonicalTracks).values({
        id,
        userId: targetUserId,
        isrc: row.isrc,
        normalizedTitle: row.normalizedTitle,
        normalizedArtist: row.normalizedArtist,
        displayTitle: row.displayTitle,
        displayArtist: row.displayArtist,
        durationMs: row.durationMs,
        dedupeKey: row.dedupeKey,
      });
      target = { id };
    }

    const existingMembership = (
      await db
        .select({ trackId: canonicalPlaylistTracks.canonicalTrackId })
        .from(canonicalPlaylistTracks)
        .where(
          and(
            eq(canonicalPlaylistTracks.canonicalPlaylistId, targetCanonicalId),
            eq(canonicalPlaylistTracks.canonicalTrackId, target.id)
          )
        )
        .limit(1)
    )[0];
    if (!existingMembership) {
      const count = await db
        .select({ id: canonicalPlaylistTracks.canonicalTrackId })
        .from(canonicalPlaylistTracks)
        .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, targetCanonicalId));
      await db.insert(canonicalPlaylistTracks).values({
        canonicalPlaylistId: targetCanonicalId,
        canonicalTrackId: target.id,
        position: count.length + 1,
        firstSeenProvider: row.firstSeenProvider,
      });
      added += 1;
    }

    // carry over resolved mappings so the follower's first sync is search-free
    const sourceMappings = await db
      .select()
      .from(trackMappings)
      .where(eq(trackMappings.canonicalTrackId, row.trackId));
    for (const m of sourceMappings) {
      const existingMapping = (
        await db
          .select({ id: trackMappings.id })
          .from(trackMappings)
          .where(and(eq(trackMappings.canonicalTrackId, target.id), eq(trackMappings.provider, m.provider)))
          .limit(1)
      )[0];
      if (!existingMapping) {
        await db.insert(trackMappings).values({
          id: crypto.randomUUID(),
          canonicalTrackId: target.id,
          provider: m.provider,
          providerTrackId: m.providerTrackId,
          providerUri: m.providerUri,
          matchMethod: m.matchMethod,
          confidence: m.confidence,
        });
      }
    }
  }
  return added;
}

// --- import / follow ---

export async function importShared(
  userId: string,
  slug: string,
  opts: { follow: boolean }
): Promise<{ ok: true; canonicalPlaylistId: string } | { ok: false; error: string }> {
  const share = await getShareBySlug(slug);
  if (!share || share.revokedAt) return { ok: false, error: "This share link is no longer available." };
  if (share.ownerId === userId && opts.follow) {
    return { ok: false, error: "That's your own playlist — no need to follow it." };
  }

  const db = await getDb();
  const canonicalId = crypto.randomUUID();
  await db.insert(canonicalPlaylists).values({
    id: canonicalId,
    userId,
    name: share.name,
    syncEnabled: true,
  });
  await copyCanonicalTracks(db, share.canonicalId, userId, canonicalId);

  if (opts.follow) {
    const already = (
      await db
        .select({ id: playlistFollows.id })
        .from(playlistFollows)
        .where(
          and(
            eq(playlistFollows.sourceCanonicalPlaylistId, share.canonicalId),
            eq(playlistFollows.followerUserId, userId),
            isNull(playlistFollows.detachedAt)
          )
        )
        .limit(1)
    )[0];
    if (!already) {
      await db.insert(playlistFollows).values({
        id: crypto.randomUUID(),
        sourceCanonicalPlaylistId: share.canonicalId,
        followerCanonicalPlaylistId: canonicalId,
        followerUserId: userId,
      });
    }
  }
  return { ok: true, canonicalPlaylistId: canonicalId };
}

export async function getFollowForOwnCanonical(userId: string, ownCanonicalId: string) {
  const db = await getDb();
  const owned = (
    await db
      .select({ id: canonicalPlaylists.id })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, ownCanonicalId), eq(canonicalPlaylists.userId, userId)))
      .limit(1)
  )[0];
  if (!owned) return null;
  return (
    (
      await db
        .select({
          id: playlistFollows.id,
          sourceCanonicalPlaylistId: playlistFollows.sourceCanonicalPlaylistId,
          detachedAt: playlistFollows.detachedAt,
          ownerEmail: users.email,
        })
        .from(playlistFollows)
        .innerJoin(
          canonicalPlaylists,
          eq(canonicalPlaylists.id, playlistFollows.sourceCanonicalPlaylistId)
        )
        .innerJoin(users, eq(users.id, canonicalPlaylists.userId))
        .where(eq(playlistFollows.followerCanonicalPlaylistId, ownCanonicalId))
        .limit(1)
    )[0] ?? null
  );
}

export async function detachFollow(userId: string, ownCanonicalId: string) {
  const db = await getDb();
  await db
    .update(playlistFollows)
    .set({ detachedAt: new Date() })
    .where(
      and(
        eq(playlistFollows.followerCanonicalPlaylistId, ownCanonicalId),
        eq(playlistFollows.followerUserId, userId),
        isNull(playlistFollows.detachedAt)
      )
    );
}

/** Engine hook: pull the followed source's tracks into the follower's canonical. */
export async function propagateFollow(db: AppDb, followerCanonicalId: string, followerUserId: string): Promise<number> {
  const follow = (
    await db
      .select({
        sourceCanonicalPlaylistId: playlistFollows.sourceCanonicalPlaylistId,
      })
      .from(playlistFollows)
      .where(
        and(
          eq(playlistFollows.followerCanonicalPlaylistId, followerCanonicalId),
          isNull(playlistFollows.detachedAt)
        )
      )
      .limit(1)
  )[0];
  if (!follow) return 0;
  return copyCanonicalTracks(db, follow.sourceCanonicalPlaylistId, followerUserId, followerCanonicalId);
}

// --- suggestions ---

export async function suggestTrack(
  userId: string,
  ownFollowedCanonicalId: string,
  track: { title: string; artist: string; isrc: string | null; durationMs: number | null; provider: string | null; providerTrackId: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const follow = await getFollowForOwnCanonical(userId, ownFollowedCanonicalId);
  if (!follow || follow.detachedAt) return { ok: false, error: "Only followers of a shared playlist can suggest tracks." };
  const db = await getDb();
  await db.insert(trackSuggestions).values({
    id: crypto.randomUUID(),
    canonicalPlaylistId: follow.sourceCanonicalPlaylistId,
    suggesterUserId: userId,
    title: track.title,
    artist: track.artist,
    isrc: track.isrc,
    durationMs: track.durationMs,
    provider: track.provider,
    providerTrackId: track.providerTrackId,
  });
  return { ok: true };
}

export async function listSuggestions(ownerUserId: string, canonicalPlaylistId: string) {
  const db = await getDb();
  const owned = (
    await db
      .select({ id: canonicalPlaylists.id })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, canonicalPlaylistId), eq(canonicalPlaylists.userId, ownerUserId)))
      .limit(1)
  )[0];
  if (!owned) return null;
  return db
    .select({
      id: trackSuggestions.id,
      title: trackSuggestions.title,
      artist: trackSuggestions.artist,
      isrc: trackSuggestions.isrc,
      durationMs: trackSuggestions.durationMs,
      provider: trackSuggestions.provider,
      providerTrackId: trackSuggestions.providerTrackId,
      status: trackSuggestions.status,
      suggesterEmail: users.email,
      createdAt: trackSuggestions.createdAt,
    })
    .from(trackSuggestions)
    .innerJoin(users, eq(users.id, trackSuggestions.suggesterUserId))
    .where(eq(trackSuggestions.canonicalPlaylistId, canonicalPlaylistId))
    .orderBy(desc(trackSuggestions.createdAt))
    .limit(50);
}

export async function acceptSuggestion(
  ownerUserId: string,
  suggestionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const sug = (
    await db.select().from(trackSuggestions).where(eq(trackSuggestions.id, suggestionId)).limit(1)
  )[0];
  if (!sug) return { ok: false, error: "Suggestion not found." };
  const owned = (
    await db
      .select({ id: canonicalPlaylists.id })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, sug.canonicalPlaylistId), eq(canonicalPlaylists.userId, ownerUserId)))
      .limit(1)
  )[0];
  if (!owned) return { ok: false, error: "Not your playlist." };

  // ingest with the suggester's provider mapping when available (no search needed)
  await ingestProviderTrack(
    db,
    ownerUserId,
    sug.canonicalPlaylistId,
    (sug.provider as Provider) ?? "spotify",
    {
      providerTrackId: sug.providerTrackId ?? sug.id,
      providerUri: null,
      isrc: sug.isrc,
      title: sug.title,
      artist: sug.artist,
      albumTitle: null,
      durationMs: sug.durationMs,
      explicit: false,
      isLocal: false,
      inCatalog: Boolean(sug.providerTrackId),
    }
  );
  await db.update(trackSuggestions).set({ status: "accepted" }).where(eq(trackSuggestions.id, suggestionId));
  return { ok: true };
}

export async function dismissSuggestion(ownerUserId: string, suggestionId: string) {
  const db = await getDb();
  const sug = (
    await db.select().from(trackSuggestions).where(eq(trackSuggestions.id, suggestionId)).limit(1)
  )[0];
  if (!sug) return;
  const owned = (
    await db
      .select({ id: canonicalPlaylists.id })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, sug.canonicalPlaylistId), eq(canonicalPlaylists.userId, ownerUserId)))
      .limit(1)
  )[0];
  if (!owned) return;
  await db.update(trackSuggestions).set({ status: "dismissed" }).where(eq(trackSuggestions.id, suggestionId));
}
