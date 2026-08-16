import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import type { AppDb } from "@/db";
import {
  canonicalPlaylistTracks,
  canonicalPlaylists,
  canonicalTracks,
  playlistLinks,
  providerPlaylists,
  syncRuns,
  trackMappings,
  unmatchedTracks,
} from "@/db/schema";
import { log } from "../log";
import type { MusicProviderAdapter, Provider, ProviderTrack } from "../providers/types";
import { ingestProviderTrack, upsertTrackMapping } from "./tracks";
import { dedupeKey } from "../normalize";
import { getAdaptersForUser } from "../providers";
import { propagateFollow } from "../sharing";

const STALE_RUNNING_MS = 15 * 60 * 1000;

export type SyncTrigger = "cron" | "manual" | "onboarding";

export type SyncOutcome = {
  status: "success" | "partial" | "error" | "skipped";
  ingestedCount: number;
  spotifyAddedCount: number;
  appleAddedCount: number;
  unmatchedCount: number;
  errorSummary: string | null;
};

/**
 * Atomically claim a playlist for sync. Returns false when another run is
 * already in flight (or a recent claim hasn't gone stale), preventing
 * overlapping syncs from double-adding tracks.
 */
async function claim(db: AppDb, canonicalPlaylistId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  const rows = await db
    .select({ status: canonicalPlaylists.lastSyncStatus, started: canonicalPlaylists.lastSyncStartedAt })
    .from(canonicalPlaylists)
    .where(eq(canonicalPlaylists.id, canonicalPlaylistId))
    .limit(1);
  const current = rows[0];
  if (!current) return false;
  if (current.status === "running" && current.started && current.started > staleBefore) return false;

  await db
    .update(canonicalPlaylists)
    .set({ lastSyncStatus: "running", lastSyncStartedAt: new Date() })
    .where(eq(canonicalPlaylists.id, canonicalPlaylistId));
  return true;
}

/** Membership keys used to detect an existing track even under a different provider-side ID. */
function membershipKeys(items: ProviderTrack[]): Set<string> {
  const keys = new Set<string>();
  for (const it of items) keys.add(dedupeKey({ isrc: it.isrc, title: it.title, artist: it.artist }));
  return keys;
}

/**
 * Additive bidirectional sync for one canonical playlist:
 *  1. ingest external items not yet in canonical (append, preserve order)
 *  2. per linked provider playlist, append canonical tracks it is missing
 * Never deletes, never reorders. One provider's failure doesn't block the other.
 */
export async function syncCanonicalPlaylist(
  userId: string,
  canonicalPlaylistId: string,
  trigger: SyncTrigger,
  adapters: Partial<Record<Provider, MusicProviderAdapter>>,
  dbOverride?: AppDb
): Promise<SyncOutcome> {
  const db = dbOverride ?? (await getDb());
  const claimed = await claim(db, canonicalPlaylistId);
  if (!claimed) {
    return { status: "skipped", ingestedCount: 0, spotifyAddedCount: 0, appleAddedCount: 0, unmatchedCount: 0, errorSummary: "sync already in progress" };
  }

  const runId = crypto.randomUUID();
  await db.insert(syncRuns).values({ id: runId, canonicalPlaylistId, trigger, status: "running" });

  const outcome: SyncOutcome = {
    status: "success",
    ingestedCount: 0,
    spotifyAddedCount: 0,
    appleAddedCount: 0,
    unmatchedCount: 0,
    errorSummary: null,
  };
  const errors: string[] = [];

  try {
    const links = await db
      .select({
        linkProviderPlaylistId: playlistLinks.providerPlaylistId,
        provider: providerPlaylists.provider,
        providerPlaylistId: providerPlaylists.providerPlaylistId,
        ppRowId: providerPlaylists.id,
        editable: providerPlaylists.editable,
      })
      .from(playlistLinks)
      .innerJoin(providerPlaylists, eq(providerPlaylists.id, playlistLinks.providerPlaylistId))
      .where(eq(playlistLinks.canonicalPlaylistId, canonicalPlaylistId))
      .orderBy(playlistLinks.seq); // insertion order — first-seen semantics

    // Pass 1: ingest every linked playlist's current items into the canonical universe.
    const currentItemsByLink = new Map<string, ProviderTrack[]>();
    for (const link of links) {
      const provider = link.provider as Provider;
      const adapter = adapters[provider];
      if (!adapter) {
        errors.push(`${provider} not connected`);
        continue;
      }
      try {
        const items = await adapter.getPlaylistItems(link.providerPlaylistId);
        currentItemsByLink.set(link.ppRowId, items);
        for (const item of items) {
          if (item.isLocal) {
            await recordUnmatched(db, canonicalPlaylistId, provider, item.providerTrackId, "local file — cannot be mirrored");
            continue;
          }
          const { inserted } = await ingestProviderTrack(db, userId, canonicalPlaylistId, provider, item);
          if (inserted) outcome.ingestedCount += 1;
        }
        await db
          .update(providerPlaylists)
          .set({ trackCount: items.length, lastScannedAt: new Date() })
          .where(eq(providerPlaylists.id, link.ppRowId));
      } catch (err) {
        errors.push(`${provider} fetch failed: ${summarizeError(err)}`);
        await maybeMarkDeleted(db, link.ppRowId, err);
      }
    }

    let canonicalRows = await db
      .select({
        canonicalTrackId: canonicalPlaylistTracks.canonicalTrackId,
        firstSeenProvider: canonicalPlaylistTracks.firstSeenProvider,
        dedupeKey: canonicalTracks.dedupeKey,
      })
      .from(canonicalPlaylistTracks)
      .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
      .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, canonicalPlaylistId))
      .orderBy(canonicalPlaylistTracks.position);

    // Cross-user follows: pull the followed source's tracks into this canonical
    // (in-app propagation — mappings carry over, so followers don't re-search).
    const followAdded = await propagateFollow(db, canonicalPlaylistId, userId);
    if (followAdded > 0) {
      outcome.ingestedCount += followAdded;
      // membership grew — refetch rows so pass 2 sees the new tracks
      canonicalRows = await db
        .select({
          canonicalTrackId: canonicalPlaylistTracks.canonicalTrackId,
          firstSeenProvider: canonicalPlaylistTracks.firstSeenProvider,
          dedupeKey: canonicalTracks.dedupeKey,
        })
        .from(canonicalPlaylistTracks)
        .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
        .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, canonicalPlaylistId))
        .orderBy(canonicalPlaylistTracks.position);
    }

    // Pass 2: append missing canonical tracks to each linked provider playlist.
    for (const link of links) {
      const provider = link.provider as Provider;
      const adapter = adapters[provider];
      if (!adapter) continue;
      const items = currentItemsByLink.get(link.ppRowId);
      if (!items) continue; // fetch failed in pass 1

      if (!link.editable) {
        errors.push(`${provider} playlist is not editable`);
        continue;
      }

      const currentIds = new Set(items.map((i) => i.providerTrackId));
      const currentKeys = membershipKeys(items);

      const mappings =
        canonicalRows.length > 0
          ? await db
              .select()
              .from(trackMappings)
              .where(
                and(
                  eq(trackMappings.provider, provider),
                  inArray(
                    trackMappings.canonicalTrackId,
                    canonicalRows.map((r) => r.canonicalTrackId)
                  )
                )
              )
          : [];
      const mappingByTrack = new Map(mappings.map((m) => [m.canonicalTrackId, m]));

      const toAdd: string[] = [];
      for (const row of canonicalRows) {
        const mapping = mappingByTrack.get(row.canonicalTrackId);
        // present if the mapped provider ID is in the playlist, or if any playlist
        // item carries the same identity key (ISRC / normalized metadata) — this is
        // what keeps re-runs idempotent even when provider-side IDs differ.
        const presentById = mapping && currentIds.has(mapping.providerTrackId);
        const presentByKey = currentKeys.has(row.dedupeKey);
        if (presentById || presentByKey) continue;

        if (mapping) {
          toAdd.push(mapping.providerTrackId);
          continue;
        }
        // resolve against the provider catalog
        const canonicalDetail = await getCanonicalDetail(db, row.canonicalTrackId);
        if (!canonicalDetail) continue;
        const resolution = await adapter.resolveTrack(canonicalDetail);
        if (resolution.status === "matched") {
          await upsertTrackMapping(
            db,
            row.canonicalTrackId,
            provider,
            resolution.providerTrackId,
            resolution.providerUri,
            resolution.matchMethod,
            resolution.confidence
          );
          toAdd.push(resolution.providerTrackId);
        } else {
          await recordUnmatched(
            db,
            canonicalPlaylistId,
            row.firstSeenProvider,
            mappingByTrack.get(row.canonicalTrackId)?.providerTrackId ?? row.canonicalTrackId,
            `no match on ${provider}: ${resolution.reason}`
          );
        }
      }

      if (toAdd.length > 0) {
        try {
          await adapter.addTracks(link.providerPlaylistId, toAdd);
          if (provider === "spotify") outcome.spotifyAddedCount += toAdd.length;
          else outcome.appleAddedCount += toAdd.length;
        } catch (err) {
          errors.push(`${provider} add failed: ${summarizeError(err)}`);
        }
      }
    }

    const openUnmatched = await db
      .select({ id: unmatchedTracks.id })
      .from(unmatchedTracks)
      .where(and(eq(unmatchedTracks.canonicalPlaylistId, canonicalPlaylistId), eq(unmatchedTracks.status, "open")));
    outcome.unmatchedCount = openUnmatched.length;

    if (errors.length > 0) outcome.status = "partial";
    else if (outcome.unmatchedCount > 0) outcome.status = "partial";
    else outcome.status = "success";
    outcome.errorSummary = errors.length > 0 ? errors.join("; ").slice(0, 1000) : null;
  } catch (err) {
    outcome.status = "error";
    outcome.errorSummary = summarizeError(err);
    log.error("sync failed", { canonicalPlaylistId, err: outcome.errorSummary });
  }

  const now = new Date();
  await db
    .update(syncRuns)
    .set({
      status: outcome.status,
      completedAt: now,
      ingestedCount: outcome.ingestedCount,
      spotifyAddedCount: outcome.spotifyAddedCount,
      appleAddedCount: outcome.appleAddedCount,
      unmatchedCount: outcome.unmatchedCount,
      errorSummary: outcome.errorSummary,
    })
    .where(eq(syncRuns.id, runId));
  await db
    .update(canonicalPlaylists)
    .set({ lastSyncStatus: outcome.status, lastSyncCompletedAt: now })
    .where(eq(canonicalPlaylists.id, canonicalPlaylistId));

  return outcome;
}

async function getCanonicalDetail(db: AppDb, canonicalTrackId: string) {
  const row = (
    await db.select().from(canonicalTracks).where(eq(canonicalTracks.id, canonicalTrackId)).limit(1)
  )[0];
  if (!row) return null;
  return {
    isrc: row.isrc,
    title: row.displayTitle,
    artist: row.displayArtist,
    durationMs: row.durationMs,
  };
}

export async function recordUnmatched(
  db: AppDb,
  canonicalPlaylistId: string,
  sourceProvider: Provider | string,
  sourceTrackId: string,
  reason: string
): Promise<void> {
  const existing = (
    await db
      .select()
      .from(unmatchedTracks)
      .where(
        and(
          eq(unmatchedTracks.canonicalPlaylistId, canonicalPlaylistId),
          eq(unmatchedTracks.sourceProvider, sourceProvider),
          eq(unmatchedTracks.sourceTrackId, sourceTrackId)
        )
      )
      .limit(1)
  )[0];
  if (existing) {
    await db
      .update(unmatchedTracks)
      .set({ lastAttemptAt: new Date(), reason, status: "open" })
      .where(eq(unmatchedTracks.id, existing.id));
  } else {
    await db.insert(unmatchedTracks).values({
      id: crypto.randomUUID(),
      canonicalPlaylistId,
      sourceProvider,
      sourceTrackId,
      reason,
    });
  }
}

async function maybeMarkDeleted(db: AppDb, providerPlaylistRowId: string, err: unknown): Promise<void> {
  const status = (err as { status?: number }).status;
  if (status === 404 || status === 410) {
    await db
      .update(providerPlaylists)
      .set({ archivedAt: new Date() })
      .where(eq(providerPlaylists.id, providerPlaylistRowId));
  }
}

export function summarizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/Bearer\s+[\w.-]+/g, "Bearer [redacted]").slice(0, 300);
}

/**
 * Sync every enabled canonical playlist for every user (cron entrypoint).
 * One playlist's failure never aborts the rest.
 */
export async function syncAllEnabled(
  dbOverride?: AppDb,
  adaptersForUser: (userId: string) => Promise<Partial<Record<Provider, MusicProviderAdapter>>> = (userId) => getAdaptersForUser(userId)
): Promise<{ attempted: number; results: Record<string, SyncOutcome> }> {
  const db = dbOverride ?? (await getDb());
  const enabled = await db
    .select({ id: canonicalPlaylists.id, userId: canonicalPlaylists.userId })
    .from(canonicalPlaylists)
    .where(eq(canonicalPlaylists.syncEnabled, true));

  const results: Record<string, SyncOutcome> = {};
  for (const row of enabled) {
    try {
      const adapters = await adaptersForUser(row.userId);
      results[row.id] = await syncCanonicalPlaylist(row.userId, row.id, "cron", adapters, db);
    } catch (err) {
      log.error("cron sync crashed for playlist", { canonicalPlaylistId: row.id, err: summarizeError(err) });
      results[row.id] = {
        status: "error",
        ingestedCount: 0,
        spotifyAddedCount: 0,
        appleAddedCount: 0,
        unmatchedCount: 0,
        errorSummary: summarizeError(err),
      };
    }
  }
  return { attempted: enabled.length, results };
}
