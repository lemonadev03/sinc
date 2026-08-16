import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb, seedUser, seedConnection, seedProviderPlaylist, seedCanonicalGroup, FakeAdapter, track } from "./helpers";
import { syncCanonicalPlaylist } from "@/lib/sync/engine";

async function setup() {
  const db = await makeTestDb();
  return { db };
}

describe("canonicalization: union + dedupe with first-seen order", () => {
  it("links two playlists into a deduped union and pushes missing tracks both ways", async () => {
    const { db } = await setup();
    const userId = await seedUser(db);

    // Spotify playlist: Song One (isrc AAA), Song Two (isrc BBB)
    const spotify = new FakeAdapter("spotify");
    spotify.addPlaylist("sp-pl-1", "Gym", [
      track({ providerTrackId: "sp1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" }),
      track({ providerTrackId: "sp2", isrc: "BBB000000002", title: "Song Two", artist: "Artist Y" }),
    ]);
    // Apple playlist: same Song One under a different title variant (same ISRC), plus Song Three
    const apple = new FakeAdapter("apple");
    apple.addPlaylist("am-pl-1", "Gym (Apple)", [
      track({ providerTrackId: "am1", isrc: "AAA000000001", title: "Song One - Remastered", artist: "Artist X" }),
      track({ providerTrackId: "am3", isrc: "CCC000000003", title: "Song Three", artist: "Artist Z" }),
    ]);
    // cross-provider catalogs for resolution
    spotify.catalog = [
      track({ providerTrackId: "sp1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" }),
      track({ providerTrackId: "sp2", isrc: "BBB000000002", title: "Song Two", artist: "Artist Y" }),
      track({ providerTrackId: "sp3", isrc: "CCC000000003", title: "Song Three", artist: "Artist Z" }),
    ];
    apple.catalog = [
      track({ providerTrackId: "am1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" }),
      track({ providerTrackId: "am2", isrc: "BBB000000002", title: "Song Two", artist: "Artist Y" }),
      track({ providerTrackId: "am3", isrc: "CCC000000003", title: "Song Three", artist: "Artist Z" }),
    ];

    const spRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "spotify"), "spotify", "Gym", "sp-row-1");
    const amRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "apple"), "apple", "Gym (Apple)", "am-row-1");
    // point rows at the fake provider playlist ids
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "sp-pl-1" }).where(eq(schema.providerPlaylists.id, spRow));
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "am-pl-1" }).where(eq(schema.providerPlaylists.id, amRow));

    const canonicalId = await seedCanonicalGroup(db, userId, [spRow, amRow]);
    const outcome = await syncCanonicalPlaylist(userId, canonicalId, "onboarding", { spotify, apple }, db);

    expect(outcome.status).toBe("success");
    expect(outcome.ingestedCount).toBe(3); // union of {1,2} and {1,3} = 3
    expect(outcome.spotifyAddedCount).toBe(1); // Song Three pushed to Spotify
    expect(outcome.appleAddedCount).toBe(1); // Song Two pushed to Apple

    // canonical membership: 3 unique tracks, first-seen order (Spotify link first)
    const rows = await db
      .select({ position: schema.canonicalPlaylistTracks.position, title: schema.canonicalTracks.displayTitle, provider: schema.canonicalPlaylistTracks.firstSeenProvider })
      .from(schema.canonicalPlaylistTracks)
      .innerJoin(schema.canonicalTracks, eq(schema.canonicalTracks.id, schema.canonicalPlaylistTracks.canonicalTrackId))
      .where(eq(schema.canonicalPlaylistTracks.canonicalPlaylistId, canonicalId))
      .orderBy(schema.canonicalPlaylistTracks.position);
    expect(rows.map((r) => r.title)).toEqual(["Song One", "Song Two", "Song Three"]);
    expect(rows.map((r) => r.provider)).toEqual(["spotify", "spotify", "apple"]);
    // Song One deduped by ISRC despite the remastered title on Apple
    expect(rows).toHaveLength(3);

    // providers received exactly the missing tracks
    expect(apple.addedCalls).toEqual([{ playlistId: "am-pl-1", trackIds: ["am2"] }]);
    expect(spotify.addedCalls).toEqual([{ playlistId: "sp-pl-1", trackIds: ["sp3"] }]);
  });

  it("dedupes metadata-only twins when no ISRC is available", async () => {
    const { db } = await setup();
    const userId = await seedUser(db);

    const spotify = new FakeAdapter("spotify", [
      track({ providerTrackId: "sp1", title: "Local Band Hit", artist: "Local Band" }),
    ]);
    spotify.addPlaylist("sp-pl-1", "Hits", [
      track({ providerTrackId: "sp1", title: "Local Band Hit", artist: "Local Band" }),
    ]);
    const apple = new FakeAdapter("apple", [
      track({ providerTrackId: "am1", title: "Local Band Hit", artist: "Local Band" }),
    ]);
    apple.addPlaylist("am-pl-1", "Hits (Apple)", [
      // same song, no ISRCs anywhere — must collapse to one canonical track
      track({ providerTrackId: "am1", title: "Local Band Hit", artist: "Local Band" }),
    ]);

    const spRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "spotify"), "spotify", "Hits", "sp-row-1");
    const amRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "apple"), "apple", "Hits (Apple)", "am-row-1");
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "sp-pl-1" }).where(eq(schema.providerPlaylists.id, spRow));
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "am-pl-1" }).where(eq(schema.providerPlaylists.id, amRow));

    const canonicalId = await seedCanonicalGroup(db, userId, [spRow, amRow]);
    await syncCanonicalPlaylist(userId, canonicalId, "onboarding", { spotify, apple }, db);

    const rows = await db
      .select({ id: schema.canonicalPlaylistTracks.canonicalTrackId })
      .from(schema.canonicalPlaylistTracks)
      .where(eq(schema.canonicalPlaylistTracks.canonicalPlaylistId, canonicalId));
    expect(rows).toHaveLength(1);
  });
});

describe("ISRC-first track mapping", () => {
  it("records mappings with match methods and prefers ISRC resolution", async () => {
    const { db } = await setup();
    const userId = await seedUser(db);

    const spotify = new FakeAdapter("spotify");
    spotify.addPlaylist("sp-pl-1", "Mix", [
      track({ providerTrackId: "sp9", isrc: "ZZZ000000009", title: "Isrc Song", artist: "A" }),
    ]);
    const apple = new FakeAdapter("apple", [
      track({ providerTrackId: "am9", isrc: "ZZZ000000009", title: "Isrc Song", artist: "A" }),
    ]);
    apple.addPlaylist("am-pl-1", "Mix (Apple)", []);

    const spRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "spotify"), "spotify", "Mix", "sp-row-1");
    const amRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "apple"), "apple", "Mix (Apple)", "am-row-1");
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "sp-pl-1" }).where(eq(schema.providerPlaylists.id, spRow));
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "am-pl-1" }).where(eq(schema.providerPlaylists.id, amRow));

    const canonicalId = await seedCanonicalGroup(db, userId, [spRow, amRow]);
    await syncCanonicalPlaylist(userId, canonicalId, "onboarding", { spotify, apple }, db);

    const canonicalTrack = (
      await db.select().from(schema.canonicalTracks).where(eq(schema.canonicalTracks.userId, userId)).limit(1)
    )[0];
    const mappings = await db.select().from(schema.trackMappings).where(eq(schema.trackMappings.canonicalTrackId, canonicalTrack.id));
    const byProvider = Object.fromEntries(mappings.map((m) => [m.provider, m]));
    expect(byProvider.spotify.matchMethod).toBe("isrc"); // direct from source track
    expect(byProvider.apple.matchMethod).toBe("isrc"); // resolved via ISRC catalog
    expect(byProvider.apple.providerTrackId).toBe("am9");
  });

  it("leaves unresolvable tracks unmatched instead of guessing", async () => {
    const { db } = await setup();
    const userId = await seedUser(db);

    const spotify = new FakeAdapter("spotify", [
      track({ providerTrackId: "spA", isrc: "QQQ000000001", title: "Obscure Track", artist: "Unknown" }),
    ]);
    spotify.addPlaylist("sp-pl-1", "Deep Cuts", [
      track({ providerTrackId: "spA", isrc: "QQQ000000001", title: "Obscure Track", artist: "Unknown" }),
    ]);
    const apple = new FakeAdapter("apple", []); // empty catalog
    apple.addPlaylist("am-pl-1", "Deep Cuts (Apple)", []);

    const spRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "spotify"), "spotify", "Deep Cuts", "sp-row-1");
    const amRow = await seedProviderPlaylist(db, userId, await seedConnection(db, userId, "apple"), "apple", "Deep Cuts (Apple)", "am-row-1");
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "sp-pl-1" }).where(eq(schema.providerPlaylists.id, spRow));
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "am-pl-1" }).where(eq(schema.providerPlaylists.id, amRow));

    const canonicalId = await seedCanonicalGroup(db, userId, [spRow, amRow]);
    const outcome = await syncCanonicalPlaylist(userId, canonicalId, "onboarding", { spotify, apple }, db);

    expect(outcome.appleAddedCount).toBe(0);
    expect(outcome.unmatchedCount).toBe(1);
    expect(outcome.status).toBe("partial");
    const unmatched = await db.select().from(schema.unmatchedTracks).where(eq(schema.unmatchedTracks.canonicalPlaylistId, canonicalId));
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].sourceProvider).toBe("spotify");
    expect(unmatched[0].reason).toContain("no match on apple");
  });
});
