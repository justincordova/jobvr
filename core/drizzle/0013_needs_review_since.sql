ALTER TABLE "companies" ADD COLUMN "needs_review_since" timestamp with time zone;--> statement-breakpoint
-- When a board broke wasn't recorded: start the clock now, so none gives up early
UPDATE "companies" SET "needs_review_since" = now() WHERE "status" = 'needs_review';
