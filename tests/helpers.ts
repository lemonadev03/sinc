import postgres from "postgres";
import { createDb, type AppDb } from "@/db";
import * as schema from "@/db/schema";
import type { MusicProviderAdapter, Provider, ProviderTrack } from "@/lib/providers/types";

const TEST_SERVER = process.env.TEST_DATABASE_URL ?? "postgres://test:test@localhost:54331/test";

/**
 * Creates an isolated Postgres database per call, migrates it, and installs it
 * as the process-wide getDb() target so code under test sees the same instance.
 */
export async function makeTestDb(): Promise<AppDb> {
  process.env.ENCRYPTION_KEY = "test-encryption-key-not-for-production";
  const admin = postgres(TEST_SERVER, { max: 1 });
  const dbName = `test_${crypto.randomUUID().replace(/-/g, "")}`;
  await admin`CREATE DATABASE ${admin(dbName)}`;
  await admin.end({ timeout: 1 });

  const u = new URL(TEST_SERVER);
  u.pathname = `/${dbName}`;
  const handle = await createDb(u.toString());
  globalThis.__playlistSyncDb = handle;
  return handle.db;
}

export async function seedUser(db: AppDb, email = "user@test.dev"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({ id, email, passwordHash: "scrypt.A.A" });
  return id;
}

export async function seedConnection(db: AppDb, userId: string, provider: Provider): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.musicConnections).values({
    id,
    userId,
    provider,
    externalAccountId: `ext-${provider}`,
    connectedAt: new Date(),
  });
  return id;
}

export async function seedProviderPlaylist(
  db: AppDb,
  userId: string,
  connectionId: string,
  provider: Provider,
  name: string,
  providerPlaylistId?: string
): Promise<string> {
  const id = providerPlaylistId ?? crypto.randomUUID();
  await db.insert(schema.providerPlaylists).values({
    id,
    userId,
    musicConnectionId: connectionId,
    provider,
    providerPlaylistId: `${provider}-pl-${id.slice(0, 8)}`,
    name,
    trackCount: 0,
    lastScannedAt: new Date(),
  });
  return id;
}

export async function seedCanonicalGroup(
  db: AppDb,
  userId: string,
  linkRowIds: string[]
): Promise<string> {
  const canonicalId = crypto.randomUUID();
  await db.insert(schema.canonicalPlaylists).values({ id: canonicalId, userId, name: "Test Group" });
  for (const rowId of linkRowIds) {
    await db.insert(schema.playlistLinks).values({
      id: crypto.randomUUID(),
      canonicalPlaylistId: canonicalId,
      providerPlaylistId: rowId,
    });
  }
  return canonicalId;
}

export function track(opts: Partial<ProviderTrack> & { providerTrackId: string; title: string; artist: string }): ProviderTrack {
  return {
    providerUri: null,
    isrc: null,
    albumTitle: null,
    durationMs: 200_000,
    explicit: false,
    isLocal: false,
    inCatalog: true,
    ...opts,
  };
}

export type FakePlaylist = { name: string; items: ProviderTrack[] };

/** In-memory adapter: records writes so tests can assert idempotency. */
export class FakeAdapter implements MusicProviderAdapter {
  readonly provider: Provider;
  playlists = new Map<string, FakePlaylist>();
  addedCalls: { playlistId: string; trackIds: string[] }[] = [];
  createdPlaylists: string[] = [];
  failFetch = false;
  failAdd = false;
  /** catalog entries resolvable by isrc or normalized metadata */
  catalog: ProviderTrack[] = [];

  constructor(provider: Provider, catalog: ProviderTrack[] = []) {
    this.provider = provider;
    this.catalog = catalog;
  }

  addPlaylist(id: string, name: string, items: ProviderTrack[]): this {
    this.playlists.set(id, { name, items });
    return this;
  }

  async listPlaylists() {
    return [...this.playlists.entries()].map(([id, p]) => ({
      providerPlaylistId: id,
      name: p.name,
      externalUrl: null,
      editable: true,
      ownerExternalId: "me",
      providerRevision: null,
      trackCount: p.items.length,
    }));
  }

  async getPlaylistItems(playlistId: string): Promise<ProviderTrack[]> {
    if (this.failFetch) {
      const err = new Error(`[${this.provider}] simulated fetch failure`);
      (err as Error & { status?: number }).status = 500;
      throw err;
    }
    return [...(this.playlists.get(playlistId)?.items ?? [])];
  }

  async createPlaylist(input: { name: string }): Promise<ReturnType<MusicProviderAdapter["createPlaylist"]> extends Promise<infer T> ? T : never> {
    const id = `new-${this.provider}-${this.createdPlaylists.length + 1}`;
    this.createdPlaylists.push(id);
    this.playlists.set(id, { name: input.name, items: [] });
    return {
      providerPlaylistId: id,
      name: input.name,
      externalUrl: null,
      editable: true,
      ownerExternalId: "me",
      providerRevision: null,
      trackCount: 0,
    };
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    if (this.failAdd) {
      const err = new Error(`[${this.provider}] simulated add failure`);
      (err as Error & { status?: number }).status = 500;
      throw err;
    }
    this.addedCalls.push({ playlistId, trackIds: [...trackIds] });
    const pl = this.playlists.get(playlistId);
    if (pl) {
      for (const id of trackIds) {
        const t = this.catalog.find((c) => c.providerTrackId === id);
        if (t) pl.items.push(t);
      }
    }
  }

  async resolveTrack(canonical: { isrc: string | null; title: string; artist: string; durationMs: number | null }): Promise<
    | { status: "matched"; providerTrackId: string; providerUri: null; matchMethod: "isrc" | "metadata" | "existing"; confidence: number }
    | { status: "unmatched"; reason: string }
  > {
    if (canonical.isrc) {
      const byIsrc = this.catalog.find((c) => c.isrc === canonical.isrc);
      if (byIsrc) return { status: "matched", providerTrackId: byIsrc.providerTrackId, providerUri: null, matchMethod: "isrc", confidence: 95 };
    }
    const byMeta = this.catalog.find(
      (c) => c.title.toLowerCase() === canonical.title.toLowerCase() && c.artist.toLowerCase() === canonical.artist.toLowerCase()
    );
    if (byMeta) return { status: "matched", providerTrackId: byMeta.providerTrackId, providerUri: null, matchMethod: "metadata", confidence: 75 };
    return { status: "unmatched", reason: "not in fake catalog" };
  }
}
