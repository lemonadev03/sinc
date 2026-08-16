import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import type { AppDb } from "@/db";
import { canonicalPlaylists, musicConnections, playlistLinks, providerPlaylists } from "@/db/schema";
import { log } from "../log";
import type { MusicProviderAdapter, Provider } from "../providers/types";
import { getAdaptersForUser } from "../providers";
import { syncCanonicalPlaylist } from "./engine";
import { MIRROR_DESCRIPTION } from "../sharing";

/** Fetch all playlists from a provider and upsert them into the inventory. */
export async function refreshProviderPlaylists(
  userId: string,
  provider: Provider,
  adapter: MusicProviderAdapter
): Promise<number> {
  const db = await getDb();
  const conn = (
    await db
      .select()
      .from(musicConnections)
      .where(and(eq(musicConnections.userId, userId), eq(musicConnections.provider, provider)))
      .limit(1)
  )[0];
  if (!conn) throw new Error(`${provider} not connected`);

  const remote = await adapter.listPlaylists();
  const remoteIds = new Set(remote.map((p) => p.providerPlaylistId));

  for (const p of remote) {
    await db
      .insert(providerPlaylists)
      .values({
        id: crypto.randomUUID(),
        userId,
        musicConnectionId: conn.id,
        provider,
        providerPlaylistId: p.providerPlaylistId,
        name: p.name,
        externalUrl: p.externalUrl,
        editable: p.editable,
        ownerExternalId: p.ownerExternalId,
        providerRevision: p.providerRevision,
        trackCount: p.trackCount,
        lastScannedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [providerPlaylists.userId, providerPlaylists.provider, providerPlaylists.providerPlaylistId],
        set: {
          name: p.name,
          externalUrl: p.externalUrl,
          editable: p.editable,
          ownerExternalId: p.ownerExternalId,
          providerRevision: p.providerRevision,
          trackCount: p.trackCount,
          lastScannedAt: new Date(),
          archivedAt: null,
          musicConnectionId: conn.id,
        },
      });
  }

  // archive inventory rows that no longer exist remotely
  const local = await db
    .select({ id: providerPlaylists.id, providerPlaylistId: providerPlaylists.providerPlaylistId })
    .from(providerPlaylists)
    .where(and(eq(providerPlaylists.userId, userId), eq(providerPlaylists.provider, provider)));
  for (const row of local) {
    if (!remoteIds.has(row.providerPlaylistId)) {
      await db
        .update(providerPlaylists)
        .set({ archivedAt: new Date() })
        .where(eq(providerPlaylists.id, row.id));
    }
  }
  return remote.length;
}

export type CreateGroupResult =
  | { ok: true; canonicalPlaylistId: string }
  | { ok: false; error: string };

/**
 * Create a canonical playlist from one or two existing provider playlists
 * (opt-in sync group), then run the initial additive sync which canonicalizes
 * the union and pushes missing tracks both ways.
 */
export async function createSyncGroup(
  userId: string,
  input: { providerPlaylistRowIds: string[]; name?: string },
  dbOverride?: AppDb
): Promise<CreateGroupResult> {
  const db = dbOverride ?? (await getDb());
  const ids = [...new Set(input.providerPlaylistRowIds)];
  if (ids.length === 0 || ids.length > 2) return { ok: false, error: "Select one or two playlists." };

  // ownership boundary: every selected playlist must belong to this user
  const rows = await db
    .select()
    .from(providerPlaylists)
    .where(and(eq(providerPlaylists.userId, userId), inArray(providerPlaylists.id, ids)));
  if (rows.length !== ids.length) return { ok: false, error: "Playlist not found for this account." };
  const providers = new Set(rows.map((r) => r.provider));
  if (providers.size !== rows.length) return { ok: false, error: "Pick at most one playlist per provider." };

  const name = input.name?.trim() || rows[0].name;
  const canonicalId = crypto.randomUUID();
  await db.insert(canonicalPlaylists).values({ id: canonicalId, userId, name });
  for (const row of rows) {
    await db.insert(playlistLinks).values({
      id: crypto.randomUUID(),
      canonicalPlaylistId: canonicalId,
      providerPlaylistId: row.id,
    });
  }

  const adapters = await getAdaptersForUser(userId);
  const outcome = await syncCanonicalPlaylist(userId, canonicalId, "onboarding", adapters, db);
  log.info("sync group created", { canonicalId, status: outcome.status });
  return { ok: true, canonicalPlaylistId: canonicalId };
}

/**
 * Create a sync group from a single playlist and create the missing mirror
 * playlist on the other provider (same name), then link + initial sync.
 */
export async function createSyncGroupWithMirror(
  userId: string,
  providerPlaylistRowId: string
): Promise<CreateGroupResult> {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(providerPlaylists)
      .where(and(eq(providerPlaylists.userId, userId), eq(providerPlaylists.id, providerPlaylistRowId)))
      .limit(1)
  )[0];
  if (!row) return { ok: false, error: "Playlist not found for this account." };

  const otherProvider: Provider = row.provider === "spotify" ? "apple" : "spotify";
  const adapters = await getAdaptersForUser(userId);
  const otherAdapter = adapters[otherProvider];
  if (!otherAdapter) {
    return { ok: false, error: `Connect ${otherProvider === "apple" ? "Apple Music" : "Spotify"} first — needed to create the mirror playlist.` };
  }

  const conn = (
    await db
      .select()
      .from(musicConnections)
      .where(and(eq(musicConnections.userId, userId), eq(musicConnections.provider, otherProvider)))
      .limit(1)
  )[0];
  if (!conn) return { ok: false, error: `${otherProvider} not connected` };

  const created = await otherAdapter.createPlaylist({
    name: row.name,
    description: MIRROR_DESCRIPTION,
  });
  const mirrorRowId = crypto.randomUUID();
  await db.insert(providerPlaylists).values({
    id: mirrorRowId,
    userId,
    musicConnectionId: conn.id,
    provider: otherProvider,
    providerPlaylistId: created.providerPlaylistId,
    name: created.name,
    externalUrl: created.externalUrl,
    editable: created.editable,
    ownerExternalId: created.ownerExternalId,
    providerRevision: created.providerRevision,
    trackCount: created.trackCount,
    lastScannedAt: new Date(),
  });

  return createSyncGroup(userId, { providerPlaylistRowIds: [row.id, mirrorRowId], name: row.name }, db);
}

/** Link an additional provider playlist to an existing canonical playlist. */
export async function linkProviderPlaylist(
  userId: string,
  canonicalPlaylistId: string,
  providerPlaylistRowId: string
): Promise<CreateGroupResult> {
  const db = await getDb();
  const canonical = (
    await db
      .select()
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.userId, userId), eq(canonicalPlaylists.id, canonicalPlaylistId)))
      .limit(1)
  )[0];
  if (!canonical) return { ok: false, error: "Canonical playlist not found for this account." };
  const row = (
    await db
      .select()
      .from(providerPlaylists)
      .where(and(eq(providerPlaylists.userId, userId), eq(providerPlaylists.id, providerPlaylistRowId)))
      .limit(1)
  )[0];
  if (!row) return { ok: false, error: "Playlist not found for this account." };

  const existing = await db
    .select({ id: playlistLinks.id })
    .from(playlistLinks)
    .where(eq(playlistLinks.canonicalPlaylistId, canonicalPlaylistId));
  const existingProviders = await db
    .select({ provider: providerPlaylists.provider })
    .from(providerPlaylists)
    .where(inArray(providerPlaylists.id, existing.map((e) => e.id)));
  if (existingProviders.some((p) => p.provider === row.provider)) {
    return { ok: false, error: "This canonical playlist already has a link for that provider." };
  }

  await db.insert(playlistLinks).values({
    id: crypto.randomUUID(),
    canonicalPlaylistId,
    providerPlaylistId: row.id,
  });
  const adapters = await getAdaptersForUser(userId);
  await syncCanonicalPlaylist(userId, canonicalPlaylistId, "manual", adapters, db);
  return { ok: true, canonicalPlaylistId };
}

/**
 * Create a mirror playlist on `provider` for a canonical playlist that has no
 * link for it yet (used by shared imports and unlinked canonicals), then sync.
 */
export async function createMirrorForCanonical(
  userId: string,
  canonicalPlaylistId: string,
  provider: Provider
): Promise<CreateGroupResult> {
  const db = await getDb();
  const canonical = (
    await db
      .select()
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, canonicalPlaylistId), eq(canonicalPlaylists.userId, userId)))
      .limit(1)
  )[0];
  if (!canonical) return { ok: false, error: "Playlist not found for this account." };

  const existingLinks = await db
    .select({ providerPlaylistId: playlistLinks.providerPlaylistId })
    .from(playlistLinks)
    .where(eq(playlistLinks.canonicalPlaylistId, canonicalPlaylistId));
  const existingProviders = existingLinks.length
    ? await db
        .select({ provider: providerPlaylists.provider })
        .from(providerPlaylists)
        .where(inArray(providerPlaylists.id, existingLinks.map((l) => l.providerPlaylistId)))
    : [];
  if (existingProviders.some((p) => p.provider === provider)) {
    return { ok: false, error: `This playlist already has a ${provider} link.` };
  }

  const adapters = await getAdaptersForUser(userId);
  const adapter = adapters[provider];
  if (!adapter) {
    return { ok: false, error: `Connect ${provider === "apple" ? "Apple Music" : "Spotify"} first.` };
  }
  const conn = (
    await db
      .select()
      .from(musicConnections)
      .where(and(eq(musicConnections.userId, userId), eq(musicConnections.provider, provider)))
      .limit(1)
  )[0];
  if (!conn) return { ok: false, error: `${provider} not connected` };

  const created = await adapter.createPlaylist({
    name: canonical.name,
    description: MIRROR_DESCRIPTION,
  });
  const mirrorRowId = crypto.randomUUID();
  await db.insert(providerPlaylists).values({
    id: mirrorRowId,
    userId,
    musicConnectionId: conn.id,
    provider,
    providerPlaylistId: created.providerPlaylistId,
    name: created.name,
    externalUrl: created.externalUrl,
    editable: created.editable,
    ownerExternalId: created.ownerExternalId,
    providerRevision: created.providerRevision,
    trackCount: created.trackCount,
    lastScannedAt: new Date(),
  });
  await db.insert(playlistLinks).values({
    id: crypto.randomUUID(),
    canonicalPlaylistId,
    providerPlaylistId: mirrorRowId,
  });

  const freshAdapters = await getAdaptersForUser(userId);
  await syncCanonicalPlaylist(userId, canonicalPlaylistId, "manual", freshAdapters, db);
  return { ok: true, canonicalPlaylistId };
}
