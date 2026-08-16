CREATE TABLE "playlist_follows" (
	"id" text PRIMARY KEY NOT NULL,
	"source_canonical_playlist_id" text NOT NULL,
	"follower_canonical_playlist_id" text NOT NULL,
	"follower_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playlist_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_playlist_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "track_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_playlist_id" text NOT NULL,
	"suggester_user_id" text NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"isrc" text,
	"duration_ms" integer,
	"provider" text,
	"provider_track_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playlist_follows" ADD CONSTRAINT "playlist_follows_source_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("source_canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_follows" ADD CONSTRAINT "playlist_follows_follower_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("follower_canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_follows" ADD CONSTRAINT "playlist_follows_follower_user_id_users_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_shares" ADD CONSTRAINT "playlist_shares_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_shares" ADD CONSTRAINT "playlist_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_suggestions" ADD CONSTRAINT "track_suggestions_canonical_playlist_id_canonical_playlists_id_fk" FOREIGN KEY ("canonical_playlist_id") REFERENCES "public"."canonical_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_suggestions" ADD CONSTRAINT "track_suggestions_suggester_user_id_users_id_fk" FOREIGN KEY ("suggester_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_follows_source_follower_idx" ON "playlist_follows" USING btree ("source_canonical_playlist_id","follower_user_id");--> statement-breakpoint
CREATE INDEX "playlist_follows_follower_canonical_idx" ON "playlist_follows" USING btree ("follower_canonical_playlist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_shares_canonical_idx" ON "playlist_shares" USING btree ("canonical_playlist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_shares_slug_idx" ON "playlist_shares" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "track_suggestions_canonical_idx" ON "track_suggestions" USING btree ("canonical_playlist_id","status");