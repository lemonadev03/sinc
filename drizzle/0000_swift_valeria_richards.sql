CREATE TABLE "canonical_playlist_tracks" (
	"canonical_playlist_id" text NOT NULL,
	"canonical_track_id" text NOT NULL,
	"position" integer NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_provider" text NOT NULL,
	CONSTRAINT "canonical_playlist_tracks_canonical_playlist_id_canonical_track_id_pk" PRIMARY KEY("canonical_playlist_id","canonical_track_id")
);
--> statement-breakpoint
CREATE TABLE "canonical_playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_mode" text DEFAULT 'bidirectional_additive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_completed_at" timestamp with time zone,
	"last_sync_status" text
);
--> statement-breakpoint
CREATE TABLE "canonical_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"isrc" text,
	"normalized_title" text,
	"normalized_artist" text,
	"display_title" text NOT NULL,
	"display_artist" text NOT NULL,
	"duration_ms" integer,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text,
	"external_account_name" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"music_user_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"storefront" text,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playlist_links" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"canonical_playlist_id" text NOT NULL,
	"provider_playlist_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"music_connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_playlist_id" text NOT NULL,
	"name" text NOT NULL,
	"external_url" text,
	"editable" boolean DEFAULT true NOT NULL,
	"owner_external_id" text,
	"provider_revision" text,
	"track_count" integer DEFAULT 0 NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_playlist_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"ingested_count" integer DEFAULT 0 NOT NULL,
	"spotify_added_count" integer DEFAULT 0 NOT NULL,
	"apple_added_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "track_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_track_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_track_id" text NOT NULL,
	"provider_uri" text,
	"match_method" text NOT NULL,
	"confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmatched_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_playlist_id" text NOT NULL,
	"source_provider" text NOT NULL,
	"source_track_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canonical_playlist_tracks" ADD CONSTRAINT "canonical_playlist_tracks_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_playlist_tracks" ADD CONSTRAINT "canonical_playlist_tracks_canonical_track_id_canonical_tracks_id_fk" FOREIGN KEY ("canonical_track_id") REFERENCES "public"."canonical_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_playlists" ADD CONSTRAINT "canonical_playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_tracks" ADD CONSTRAINT "canonical_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_connections" ADD CONSTRAINT "music_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_links" ADD CONSTRAINT "playlist_links_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_links" ADD CONSTRAINT "playlist_links_provider_playlist_id_provider_playlists_id_fk" FOREIGN KEY ("provider_playlist_id") REFERENCES "public"."provider_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_playlists" ADD CONSTRAINT "provider_playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_playlists" ADD CONSTRAINT "provider_playlists_music_connection_id_music_connections_id_fk" FOREIGN KEY ("music_connection_id") REFERENCES "public"."music_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_mappings" ADD CONSTRAINT "track_mappings_canonical_track_id_canonical_tracks_id_fk" FOREIGN KEY ("canonical_track_id") REFERENCES "public"."canonical_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_tracks" ADD CONSTRAINT "unmatched_tracks_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canonical_playlist_tracks_track_idx" ON "canonical_playlist_tracks" USING btree ("canonical_track_id");--> statement-breakpoint
CREATE INDEX "canonical_playlists_user_idx" ON "canonical_playlists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_tracks_user_dedupe_idx" ON "canonical_tracks" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "music_connections_user_provider_idx" ON "music_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_links_canonical_provider_playlist_idx" ON "playlist_links" USING btree ("canonical_playlist_id","provider_playlist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_playlists_user_provider_pid_idx" ON "provider_playlists" USING btree ("user_id","provider","provider_playlist_id");--> statement-breakpoint
CREATE INDEX "provider_playlists_connection_idx" ON "provider_playlists" USING btree ("music_connection_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_runs_canonical_idx" ON "sync_runs" USING btree ("canonical_playlist_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "track_mappings_track_provider_idx" ON "track_mappings" USING btree ("canonical_track_id","provider");--> statement-breakpoint
CREATE INDEX "track_mappings_provider_track_idx" ON "track_mappings" USING btree ("provider","provider_track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unmatched_tracks_canonical_source_idx" ON "unmatched_tracks" USING btree ("canonical_playlist_id","source_provider","source_track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");