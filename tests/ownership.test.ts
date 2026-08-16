import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { makeTestDb, seedUser, seedConnection, seedProviderPlaylist, seedCanonicalGroup } from "./helpers";
import { createSyncGroup, linkProviderPlaylist } from "@/lib/sync/groups";
import { hashPassword } from "@/lib/crypto";

describe("auth + ownership boundaries", () => {
  it("rejects a sync group built from another user's playlists", async () => {
    const db = await makeTestDb();
    const owner = await seedUser(db, "owner@test.dev");
    const attacker = await seedUser(db, "attacker@test.dev");

    const victimRow = await seedProviderPlaylist(
      db,
      owner,
      await seedConnection(db, owner, "spotify"),
      "spotify",
      "Owner Playlist"
    );

    const result = await createSyncGroup(attacker, { providerPlaylistRowIds: [victimRow] }, db);
    expect(result.ok).toBe(false);

    // and nothing was created for the attacker
    const canonicals = await db.select().from(schema.canonicalPlaylists).where(eq(schema.canonicalPlaylists.userId, attacker));
    expect(canonicals).toHaveLength(0);
  });

  it("cannot link a foreign playlist onto an owned canonical", async () => {
    const db = await makeTestDb();
    const owner = await seedUser(db, "owner@test.dev");
    const attacker = await seedUser(db, "attacker@test.dev");

    const foreignRow = await seedProviderPlaylist(db, owner, await seedConnection(db, owner, "apple"), "apple", "Foreign");
    const ownRow = await seedProviderPlaylist(db, attacker, await seedConnection(db, attacker, "spotify"), "spotify", "Own");
    const canonicalId = await seedCanonicalGroup(db, attacker, [ownRow]);

    const result = await linkProviderPlaylist(attacker, canonicalId, foreignRow);
    expect(result.ok).toBe(false);

    const links = await db.select().from(schema.playlistLinks).where(eq(schema.playlistLinks.canonicalPlaylistId, canonicalId));
    expect(links).toHaveLength(1); // only the original own link
  });

  it("rejects two playlists from the same provider in one group", async () => {
    const db = await makeTestDb();
    const user = await seedUser(db);
    const conn = await seedConnection(db, user, "spotify");
    const a = await seedProviderPlaylist(db, user, conn, "spotify", "A");
    const b = await seedProviderPlaylist(db, user, conn, "spotify", "B");

    const result = await createSyncGroup(user, { providerPlaylistRowIds: [a, b] }, db);
    expect(result.ok).toBe(false);
  });

  it("deleting a user cascades away credentials, playlists, links, and history", async () => {
    const db = await makeTestDb();
    const user = await seedUser(db, "gone@test.dev");
    const conn = await seedConnection(db, user, "spotify");
    const row = await seedProviderPlaylist(db, user, conn, "spotify", "Bye");
    const canonicalId = await seedCanonicalGroup(db, user, [row]);

    await db.delete(schema.users).where(eq(schema.users.id, user));

    for (const table of [
      schema.musicConnections,
      schema.providerPlaylists,
      schema.canonicalPlaylists,
      schema.playlistLinks,
      schema.trackMappings,
      schema.syncRuns,
    ]) {
      const leftover = await db.select().from(table);
      expect(leftover, `${table}`).toHaveLength(0);
    }
    void canonicalId;
  });

  it("stores only hashed passwords", async () => {
    const db = await makeTestDb();
    const id = crypto.randomUUID();
    await db.insert(schema.users).values({ id, email: "pw@test.dev", passwordHash: hashPassword("super-secret-9") });
    const row = (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];
    expect(row.passwordHash).not.toContain("super-secret-9");
    expect(row.passwordHash.startsWith("scrypt.")).toBe(true);
  });
});
