import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb, seedUser, seedConnection, seedProviderPlaylist, seedCanonicalGroup, FakeAdapter, track } from "./helpers";
import { syncCanonicalPlaylist } from "@/lib/sync/engine";
import {
  createOrGetShare,
  revokeShare,
  importShared,
  detachFollow,
  suggestTrack,
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  MIRROR_DESCRIPTION,
} from "@/lib/sharing";

async function seedOwnerPlaylist(db: Awaited<ReturnType<typeof makeTestDb>>) {
  const ownerId = await seedUser(db, "owner@test.dev");
  const canonicalId = await seedCanonicalGroup(db, ownerId, []); // unlinked canonical
  // two tracks in the owner's canonical
  for (const [isrc, title] of [
    ["AAA000000001", "Song One"],
    ["BBB000000002", "Song Two"],
  ] as const) {
    const trackId = crypto.randomUUID();
    await db.insert(schema.canonicalTracks).values({
      id: trackId,
      userId: ownerId,
      isrc,
      displayTitle: title,
      displayArtist: "Artist X",
      dedupeKey: `isrc:${isrc}`,
    });
    await db.insert(schema.canonicalPlaylistTracks).values({
      canonicalPlaylistId: canonicalId,
      canonicalTrackId: trackId,
      position: title === "Song One" ? 1 : 2,
      firstSeenProvider: "spotify",
    });
    // resolved mappings the follower should inherit
    await db.insert(schema.trackMappings).values({
      id: crypto.randomUUID(),
      canonicalTrackId: trackId,
      provider: "spotify",
      providerTrackId: `sp-${isrc.slice(0, 3)}`,
      matchMethod: "isrc",
      confidence: 95,
    });
  }
  return { ownerId, canonicalId };
}

describe("share + import", () => {
  it("owner creates a share; a friend imports a full copy with mappings", async () => {
    const db = await makeTestDb();
    const { ownerId, canonicalId } = await seedOwnerPlaylist(db);

    const share = await createOrGetShare(ownerId, canonicalId);
    expect(share.ok).toBe(true);
    const slug = share.ok ? share.slug : "";

    const friendId = await seedUser(db, "friend@test.dev");
    const result = await importShared(friendId, slug, { follow: false });
    expect(result.ok).toBe(true);

    const copyTracks = await db
      .select()
      .from(schema.canonicalPlaylistTracks)
      .where(eq(schema.canonicalPlaylistTracks.canonicalPlaylistId, result.ok ? result.canonicalPlaylistId : ""));
    expect(copyTracks).toHaveLength(2);

    // mappings carried over — the friend's first sync is search-free
    const friendTrack = (
      await db.select().from(schema.canonicalTracks).where(eq(schema.canonicalTracks.userId, friendId)).limit(1)
    )[0];
    const mappings = await db
      .select()
      .from(schema.trackMappings)
      .where(eq(schema.trackMappings.canonicalTrackId, friendTrack.id));
    expect(mappings).toHaveLength(1);
    expect(mappings[0].providerTrackId).toBe("sp-AAA");
    expect(mappings[0].matchMethod).toBe("isrc");

    // import is not a follow: no follow row
    const follows = await db.select().from(schema.playlistFollows);
    expect(follows).toHaveLength(0);
  });

  it("revoked shares can't be imported; strangers can't create shares", async () => {
    const db = await makeTestDb();
    const { ownerId, canonicalId } = await seedOwnerPlaylist(db);
    const stranger = await seedUser(db, "stranger@test.dev");

    const notYours = await createOrGetShare(stranger, canonicalId);
    expect(notYours.ok).toBe(false);

    const share = await createOrGetShare(ownerId, canonicalId);
    const slug = share.ok ? share.slug : "";
    await revokeShare(ownerId, canonicalId);

    const friend = await seedUser(db, "friend2@test.dev");
    const result = await importShared(friend, slug, { follow: true });
    expect(result.ok).toBe(false);
  });
});

describe("follow propagation", () => {
  it("new owner tracks flow into the follower on their next sync, then push to their mirror", async () => {
    const db = await makeTestDb();
    const { ownerId, canonicalId } = await seedOwnerPlaylist(db);

    const friendId = await seedUser(db, "follower@test.dev");
    const shareOnce = (await createOrGetShare(ownerId, canonicalId)) as { ok: true; slug: string };
    const importResult = await importShared(friendId, shareOnce.slug, { follow: true });
    expect(importResult.ok).toBe(true);
    const followerCanonicalId = (importResult as { ok: true; canonicalPlaylistId: string }).canonicalPlaylistId;

    // follower links an apple mirror
    const apple = new FakeAdapter("apple", [
      track({ providerTrackId: "am1", isrc: "AAA000000001", title: "Song One", artist: "Artist X" }),
      track({ providerTrackId: "am2", isrc: "BBB000000002", title: "Song Two", artist: "Artist X" }),
      track({ providerTrackId: "am3", isrc: "CCC000000003", title: "New Song", artist: "Artist X" }),
    ]);
    apple.addPlaylist("am-pl", "copy", []);
    const amRow = await seedProviderPlaylist(db, friendId, await seedConnection(db, friendId, "apple"), "apple", "copy");
    await db.update(schema.providerPlaylists).set({ providerPlaylistId: "am-pl" }).where(eq(schema.providerPlaylists.id, amRow));
    await db.insert(schema.playlistLinks).values({
      id: crypto.randomUUID(),
      canonicalPlaylistId: followerCanonicalId,
      providerPlaylistId: amRow,
    });

    // first sync pushes the two imported tracks (inherited mapping skipped? no mapping for apple -> resolve via ISRC)
    await syncCanonicalPlaylist(friendId, followerCanonicalId, "cron", { apple }, db);
    expect(apple.addedCalls.flat(2).length).toBeGreaterThan(0);

    // owner adds a new song to their canonical
    const newTrackId = crypto.randomUUID();
    await db.insert(schema.canonicalTracks).values({
      id: newTrackId,
      userId: ownerId,
      isrc: "CCC000000003",
      displayTitle: "New Song",
      displayArtist: "Artist X",
      dedupeKey: "isrc:CCC000000003",
    });
    await db.insert(schema.canonicalPlaylistTracks).values({
      canonicalPlaylistId: canonicalId,
      canonicalTrackId: newTrackId,
      position: 3,
      firstSeenProvider: "spotify",
    });

    // follower's next sync pulls it in and pushes to the mirror
    const before = apple.playlists.get("am-pl")!.items.length;
    const outcome = await syncCanonicalPlaylist(friendId, followerCanonicalId, "cron", { apple }, db);
    expect(outcome.ingestedCount).toBe(1);
    expect(apple.playlists.get("am-pl")!.items.length).toBe(before + 1);
  });

  it("detaching stops propagation but keeps the copy", async () => {
    const db = await makeTestDb();
    const { ownerId, canonicalId } = await seedOwnerPlaylist(db);
    const share = (await createOrGetShare(ownerId, canonicalId)) as { ok: true; slug: string };
    const friendId = await seedUser(db, "follower@test.dev");
    const imp = (await importShared(friendId, share.slug, { follow: true })) as { ok: true; canonicalPlaylistId: string };

    await detachFollow(friendId, imp.canonicalPlaylistId);

    // owner adds another song
    const t = crypto.randomUUID();
    await db.insert(schema.canonicalTracks).values({
      id: t, userId: ownerId, isrc: "DDD000000004", displayTitle: "After Detach", displayArtist: "Artist X", dedupeKey: "isrc:DDD000000004",
    });
    await db.insert(schema.canonicalPlaylistTracks).values({
      canonicalPlaylistId: canonicalId, canonicalTrackId: t, position: 3, firstSeenProvider: "spotify",
    });

    const outcome = await syncCanonicalPlaylist(friendId, imp.canonicalPlaylistId, "cron", {}, db);
    expect(outcome.ingestedCount).toBe(0);
    const tracks = await db
      .select()
      .from(schema.canonicalPlaylistTracks)
      .where(eq(schema.canonicalPlaylistTracks.canonicalPlaylistId, imp.canonicalPlaylistId));
    expect(tracks).toHaveLength(2); // copy intact
  });
});

describe("suggest back", () => {
  it("follower suggests, owner accepts, track lands in owner's canonical; non-followers can't suggest", async () => {
    const db = await makeTestDb();
    const { ownerId, canonicalId } = await seedOwnerPlaylist(db);
    const share = (await createOrGetShare(ownerId, canonicalId)) as { ok: true; slug: string };
    const friendId = await seedUser(db, "follower@test.dev");
    const imp = (await importShared(friendId, share.slug, { follow: true })) as { ok: true; canonicalPlaylistId: string };

    // non-follower rejected
    const rando = await seedUser(db, "rando@test.dev");
    expect((await suggestTrack(rando, imp.canonicalPlaylistId, { title: "x", artist: "y", isrc: null, durationMs: null, provider: null, providerTrackId: null })).ok).toBe(false);

    // follower suggests a real track
    await suggestTrack(friendId, imp.canonicalPlaylistId, {
      title: "Banger", artist: "New Artist", isrc: "EEE000000005", durationMs: 200000,
      provider: "spotify", providerTrackId: "sp-eee",
    });

    const inbox = await listSuggestions(ownerId, canonicalId);
    expect(inbox).toHaveLength(1);
    expect(inbox![0].status).toBe("pending");
    const suggestionId = inbox![0].id;

    // stranger can't accept
    const notOwner = await acceptSuggestion(friendId, suggestionId);
    expect(notOwner.ok).toBe(false);

    // owner accepts -> canonical grows
    const ok = await acceptSuggestion(ownerId, suggestionId);
    expect(ok.ok).toBe(true);
    const ownerTracks = await db
      .select()
      .from(schema.canonicalPlaylistTracks)
      .where(eq(schema.canonicalPlaylistTracks.canonicalPlaylistId, canonicalId));
    expect(ownerTracks).toHaveLength(3);

    // suggestion consumed + dismissable forever-after
    const inbox2 = await listSuggestions(ownerId, canonicalId);
    expect(inbox2!.filter((s) => s.status === "pending")).toHaveLength(0);
    await dismissSuggestion(ownerId, suggestionId);
  });
});

describe("attribution", () => {
  it("mirror description names sinc", () => {
    expect(MIRROR_DESCRIPTION.toLowerCase()).toContain("created and managed by sinc");
  });
});
