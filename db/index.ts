import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import * as schema from "./schema";

type DbHandle = { db: ReturnType<typeof drizzle>; client: postgres.Sql };

declare global {
  // eslint-disable-next-line no-var
  var __playlistSyncDb: DbHandle | undefined;
}

function connect(url: string): DbHandle {
  const client = postgres(url, { max: 10, prepare: false });
  const db = drizzle(client, { schema });
  return { db, client };
}

async function runMigrations(url: string): Promise<void> {
  // single connection + advisory lock so concurrent bootstraps don't race
  const lockClient = postgres(url, { max: 1 });
  try {
    await lockClient`SELECT pg_advisory_lock(918273645)`;
    const lockDb = drizzle(lockClient, { schema });
    await migrate(lockDb, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await lockClient`SELECT pg_advisory_unlock(918273645)`.catch(() => {});
    await lockClient.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Creates an isolated DB handle for an explicit Postgres URL (tests).
 * Applies migrations. Caller is responsible for cleanup.
 */
export async function createDb(url: string): Promise<{ db: DbHandle["db"]; client: postgres.Sql; close: () => Promise<void> }> {
  const handle = connect(url);
  await runMigrations(url);
  return {
    db: handle.db,
    client: handle.client,
    close: async () => {
      await handle.client.end({ timeout: 5 });
    },
  };
}

/** Singleton handle for the app. Migrates once on first use. */
export async function getDb() {
  if (!globalThis.__playlistSyncDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const handle = connect(url);
    await runMigrations(url);
    globalThis.__playlistSyncDb = handle;
  }
  return globalThis.__playlistSyncDb.db;
}

export type AppDb = DbHandle["db"];
