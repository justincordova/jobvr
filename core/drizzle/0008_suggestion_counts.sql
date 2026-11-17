ALTER TABLE "suggestions" ADD COLUMN "listing_counts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Every count so far came from SimplifyJobs, the only list
UPDATE "suggestions" SET "listing_counts" = jsonb_build_object('simplify', "listing_count") WHERE "listing_count" > 0;
