import { pgTable, text, boolean, integer, bigserial, timestamp, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // random token (hashed)
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

export const musicConnections = pgTable(
  "music_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'spotify' | 'apple'
    externalAccountId: text("external_account_id"),
    externalAccountName: text("external_account_name"),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    musicUserTokenEncrypted: text("music_user_token_encrypted"),
    tokenExpiresAt: ts("token_expires_at"),
    storefront: text("storefront"),
    needsReconnect: boolean("needs_reconnect").notNull().default(false),
    connectedAt: ts("connected_at").notNull().defaultNow(),
    lastValidatedAt: ts("last_validated_at"),
  },
  (t) => [uniqueIndex("music_connections_user_provider_idx").on(t.userId, t.provider)]
);

export const providerPlaylists = pgTable(
  "provider_playlists",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    musicConnectionId: text("music_connection_id")
      .notNull()
      .references(() => musicConnections.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerPlaylistId: text("provider_playlist_id").notNull(),
    name: text("name").notNull(),
    externalUrl: text("external_url"),
    editable: boolean("editable").notNull().default(true),
    ownerExternalId: text("owner_external_id"),
    providerRevision: text("provider_revision"), // Spotify snapshot_id
    trackCount: integer("track_count").notNull().default(0),
    lastScannedAt: ts("last_scanned_at"),
    archivedAt: ts("archived_at"),
  },
  (t) => [
    uniqueIndex("provider_playlists_user_provider_pid_idx").on(
      t.userId,
      t.provider,
      t.providerPlaylistId
    ),
    index("provider_playlists_connection_idx").on(t.musicConnectionId),
  ]
);

export const canonicalPlaylists = pgTable(
  "canonical_playlists",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    syncMode: text("sync_mode").notNull().default("bidirectional_additive"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSyncStartedAt: ts("last_sync_started_at"),
    lastSyncCompletedAt: ts("last_sync_completed_at"),
    lastSyncStatus: text("last_sync_status"), // running | success | error | partial
  },
  (t) => [index("canonical_playlists_user_idx").on(t.userId)]
);

export const playlistLinks = pgTable(
  "playlist_links",
  {
    id: text("id").primaryKey(),
    // insertion order across the whole table — first-seen sync semantics
    seq: bigserial("seq", { mode: "number" }).notNull(),
    canonicalPlaylistId: text("canonical_playlist_id")
      .notNull()
      .references(() => canonicalPlaylists.id, { onDelete: "cascade" }),
    providerPlaylistId: text("provider_playlist_id")
      .notNull()
      .references(() => providerPlaylists.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playlist_links_canonical_provider_playlist_idx").on(
      t.canonicalPlaylistId,
      t.providerPlaylistId
    ),
  ]
);

export const canonicalTracks = pgTable(
  "canonical_tracks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isrc: text("isrc"),
    normalizedTitle: text("normalized_title"),
    normalizedArtist: text("normalized_artist"),
    displayTitle: text("display_title").notNull(),
    displayArtist: text("display_artist").notNull(),
    durationMs: integer("duration_ms"),
    // identity key used for dedupe: isrc:XXX or meta:title|artist
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [uniqueIndex("canonical_tracks_user_dedupe_idx").on(t.userId, t.dedupeKey)]
);

export const canonicalPlaylistTracks = pgTable(
  "canonical_playlist_tracks",
  {
    canonicalPlaylistId: text("canonical_playlist_id")
      .notNull()
      .references(() => canonicalPlaylists.id, { onDelete: "cascade" }),
    canonicalTrackId: text("canonical_track_id")
      .notNull()
      .references(() => canonicalTracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    firstSeenProvider: text("first_seen_provider").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.canonicalPlaylistId, t.canonicalTrackId] }),
    index("canonical_playlist_tracks_track_idx").on(t.canonicalTrackId),
  ]
);

export const trackMappings = pgTable(
  "track_mappings",
  {
    id: text("id").primaryKey(),
    canonicalTrackId: text("canonical_track_id")
      .notNull()
      .references(() => canonicalTracks.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerTrackId: text("provider_track_id").notNull(),
    providerUri: text("provider_uri"),
    matchMethod: text("match_method").notNull(), // existing | isrc | metadata | manual
    confidence: integer("confidence"), // 0-100
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("track_mappings_track_provider_idx").on(t.canonicalTrackId, t.provider),
    index("track_mappings_provider_track_idx").on(t.provider, t.providerTrackId),
  ]
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    canonicalPlaylistId: text("canonical_playlist_id")
      .notNull()
      .references(() => canonicalPlaylists.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(), // cron | manual | onboarding
    status: text("status").notNull(), // running | success | error | partial
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    ingestedCount: integer("ingested_count").notNull().default(0),
    spotifyAddedCount: integer("spotify_added_count").notNull().default(0),
    appleAddedCount: integer("apple_added_count").notNull().default(0),
    unmatchedCount: integer("unmatched_count").notNull().default(0),
    errorSummary: text("error_summary"),
  },
  (t) => [index("sync_runs_canonical_idx").on(t.canonicalPlaylistId, t.startedAt)]
);

export const unmatchedTracks = pgTable(
  "unmatched_tracks",
  {
    id: text("id").primaryKey(),
    canonicalPlaylistId: text("canonical_playlist_id")
      .notNull()
      .references(() => canonicalPlaylists.id, { onDelete: "cascade" }),
    sourceProvider: text("source_provider").notNull(),
    sourceTrackId: text("source_track_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"), // open | matched | resolved
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastAttemptAt: ts("last_attempt_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unmatched_tracks_canonical_source_idx").on(
      t.canonicalPlaylistId,
      t.sourceProvider,
      t.sourceTrackId
    ),
  ]
);
