ALTER TABLE "companies" ADD COLUMN "tier_source" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tier_reason" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tiered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tier_source_check" CHECK ("companies"."tier_source" in ('seed', 'auto', 'manual', 'pending'));--> statement-breakpoint
-- Companies auto-add created got a placeholder tier: let the AI rater (when configured) rate them
UPDATE "companies" SET "tier_source" = 'pending' WHERE "notes" LIKE 'Added automatically%';--> statement-breakpoint
-- No "Track" switch anymore: every company with a working board is polled
UPDATE "companies" SET "track" = true WHERE NOT "track" AND "ats" <> 'other' AND "slug" IS NOT NULL AND "status" <> 'manual_only';
