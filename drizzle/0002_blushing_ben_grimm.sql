ALTER TABLE "unmatched_tracks" ADD COLUMN "canonical_track_id" text;--> statement-breakpoint
ALTER TABLE "unmatched_tracks" ADD COLUMN "display_label" text;--> statement-breakpoint
ALTER TABLE "unmatched_tracks" ADD CONSTRAINT "unmatched_tracks_canonical_track_id_canonical_tracks_id_fk" FOREIGN KEY ("canonical_track_id") REFERENCES "public"."canonical_tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- backfill: old rows stored canonical UUIDs in source_track_id when no provider mapping existed
UPDATE unmatched_tracks SET canonical_track_id = source_track_id
WHERE source_track_id LIKE '________-____-____-____-____________'
  AND source_track_id IN (SELECT id FROM canonical_tracks);
