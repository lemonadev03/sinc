import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb, seedUser, seedConnection, seedProviderPlaylist, seedCanonicalGroup, FakeAdapter, track } from "./helpers";
import { syncCanonicalPlaylist, syncAllEnabled } from "@/lib/sync/engine";

async function setupPair() {
  const db = await makeTestDb();
  const userId = await seedUser(db);

  const spotify = new FakeAdapter("spotify", [
    track({ providerTrackId: "sp1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" }),
    track({ providerTrackId: "sp3", isrc: "CCC000000003", title: "Song Three", artist: "Artist Z" }),
  ]);
  spotify.addPlaylist("sp-pl-1", "Gym", [track({ providerTrackId: "sp1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" })]);

  const apple = new FakeAdapter("apple", [
    track({ providerTrackId: "am3", isrc: "CCC000000003", title: "Song Three", artist: "Artist Z" }),
    track({ providerTrackId: "am1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" }),
  ]);
  apple.addPlaylist("am-pl-1", "Gym (Apple)", [track({ providerTrackId: "am3", isrc: "CCC000000003", title: "Song Three", artist: "Artist Z" })]);

  const spRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "spotify"), "spotify", "Gym", "sp-row-1");
  const amRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "apple"), "apple", "Gym (Apple)", "am-row-1");
  await db.update(schema.providerPlaylists).set({ providerPlaylistId: "sp-pl-1" }).where(eq(schema.providerPlaylists.id, spRow));
  await db.update(schema.providerPlaylists).set({ providerPlaylistId: "am-pl-1" }).where(eq(schema.providerPlaylists.id, amRow));
  const canonicalId = await seedCanonicalGroup(db, userId, [spRow, amRow]);

  return { db, userId, canonicalId, spotify, apple, spRow, amRow };
}

describe("idempotent additive sync", () => {
  it("second run adds nothing and reports success", async () => {
    const { db, userId, canonicalId, spotify, apple } = await setupPair();

    const first = await syncCanonicalPlaylist(userId, canonicalId, "manual", { spotify, apple }, db);
    expect(first.ingestedCount).toBe(2);
    expect(first.spotifyAddedCount).toBe(1); // Song Three -> Spotify
    expect(first.appleAddedCount).toBe(1); // Song One -> Apple

    const second = await syncCanonicalPlaylist(userId, canonicalId, "manual", { spotify, apple }, db);
    expect(second.ingestedCount).toBe(0);
    expect(second.spotifyAddedCount).toBe(0);
    expect(second.appleAddedCount).toBe(0);
    expect(second.status).toBe("success");

    // exactly one add per provider across all runs
    expect(spotify.addedCalls).toHaveLength(1);
    expect(apple.addedCalls).toHaveLength(1);
  });

  it("a track added externally after the first run propagates on the next run", async () => {
    const { db, userId, canonicalId, spotify, apple } = await setupPair();
    await syncCanonicalPlaylist(userId, canonicalId, "manual", { spotify, apple }, db);

    // user adds a new song on the Spotify side
    spotify.playlists.get("sp-pl-1")!.items.push(
      track({ providerTrackId: "sp7", isrc: "DDD000000004", title: "Brand New", artist: "Artist N" })
    );
    apple.catalog.push(track({ providerTrackId: "am7", isrc: "DDD000000004", title: "Brand New", artist: "Artist N" }));

    const run = await syncCanonicalPlaylist(userId, canonicalId, "cron", { spotify, apple }, db);
    expect(run.ingestedCount).toBe(1);
    expect(run.appleAddedCount).toBe(1);
    expect(apple.addedCalls.at(-1)?.trackIds).toEqual(["am7"]);
  });

  it("does not delete canonical tracks removed from one provider (additive-only)", async () => {
    const { db, userId, canonicalId, spotify, apple } = await setupPair();
    await syncCanonicalPlaylist(userId, canonicalId, "manual", { spotify, apple }, db);

    // user removes Song One from Spotify only
    spotify.playlists.get("sp-pl-1")!.items = spotify.playlists.get("sp-pl-1")!.items.filter((t) => t.providerTrackId !== "sp1");

    const run = await syncCanonicalPlaylist(userId, canonicalId, "cron", { spotify, apple }, db);
    expect(run.status).toBe("success");

    // canonical membership still holds both tracks
    const rows = await db
      .select({ id: schema.canonicalPlaylistTracks.canonicalTrackId })
      .from(schema.canonicalPlaylistTracks)
      .where(eq(schema.canonicalPlaylistTracks.canonicalPlaylistId, canonicalId));
    expect(rows).toHaveLength(2);

    // Song One is NOT re-added to Spotify (it's still there via... actually it was removed) —
    // additive semantics: the canonical track remains, and since Spotify no longer has it,
    // the engine appends it back (canonical is source of truth).
    expect(run.spotifyAddedCount).toBe(1);
  });
});

describe("failure isolation", () => {
  it("one provider failing does not abort the other side or the run", async () => {
    const { db, userId, canonicalId, spotify, apple } = await setupPair();
    apple.failFetch = true;

    const outcome = await syncCanonicalPlaylist(userId, canonicalId, "cron", { spotify, apple }, db);
    expect(outcome.status).toBe("partial");
    expect(outcome.errorSummary).toContain("apple");
    // Spotify side still ingested its own tracks; nothing propagated from the failed side
    expect(outcome.ingestedCount).toBe(1);
    expect(outcome.spotifyAddedCount).toBe(0);
    expect(outcome.appleAddedCount).toBe(0);

    const runs = await db.select().from(schema.syncRuns).where(eq(schema.syncRuns.canonicalPlaylistId, canonicalId));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("partial");
  });

  it("syncAllEnabled continues past a crashing playlist", async () => {
    const db = await makeTestDb();
    const userIdA = await seedUser(db, "a@test.dev");
    const userIdB = await seedUser(db, "b@test.dev");

    // user A: healthy
    const ok = new FakeAdapter("spotify", [track({ providerTrackId: "sp1", title: "T", artist: "A" })]);
    ok.addPlaylist("pl", "OK", [track({ providerTrackId: "sp1", title: "T", artist: "A" })]);
    const rowA = await seedProviderPlaylist(db, userIdA, await seedConnection(db, userIdA, "spotify"), "spotify", "OK", "row-a");
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "pl" }).where(eq(schema.providerPlaylists.id, rowA));
    const canonicalA = await seedCanonicalGroup(db, userIdA, [rowA]);

    // user B: adapter explodes on fetch
    const bad = new FakeAdapter("spotify");
    bad.failFetch = true;
    bad.addPlaylist("pl", "Bad", []);
    const rowB = await seedProviderPlaylist(db, userIdB, await seedConnection(db, userIdB, "spotify"), "spotify", "Bad", "row-b");
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "pl" }).where(eq(schema.providerPlaylists.id, rowB));
    const canonicalB = await seedCanonicalGroup(db, userIdB, [rowB]);

    const { attempted, results } = await syncAllEnabled(db, async (uid) => ({
      spotify: uid === userIdA ? ok : bad,
    }));

    expect(attempted).toBe(2);
    expect(results[canonicalA].status).toBe("success");
    expect(results[canonicalB].status).toBe("partial");
  });
});

describe("overlap protection", () => {
  it("skips a sync when another run is already in flight", async () => {
    const { db, userId, canonicalId, spotify, apple } = await setupPair();
    await db
      .update(schema.canonicalPlaylists)
      .set({ lastSyncStatus: "running", lastSyncStartedAt: new Date() })
      .where(eq(schema.canonicalPlaylists.id, canonicalId));

    const outcome = await syncCanonicalPlaylist(userId, canonicalId, "cron", { spotify, apple }, db);
    expect(outcome.status).toBe("skipped");
    expect(spotify.addedCalls).toHaveLength(0);
  });

  it("takes over a stale running claim", async () => {
    const { db, userId, canonicalId, spotify, apple } = await setupPair();
    await db
      .update(schema.canonicalPlaylists)
      .set({ lastSyncStatus: "running", lastSyncStartedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.canonicalPlaylists.id, canonicalId));

    const outcome = await syncCanonicalPlaylist(userId, canonicalId, "cron", { spotify, apple }, db);
    expect(outcome.status).not.toBe("skipped");
  });
});
