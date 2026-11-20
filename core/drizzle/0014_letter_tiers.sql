ALTER TABLE "companies" DROP CONSTRAINT "companies_tier_check";--> statement-breakpoint
-- Letter tiers by how good a company is for a new grad: Mid, Startup and Corporate become B, C and D
UPDATE "companies" SET "tier" = CASE "tier" WHEN 'Mid' THEN 'B' WHEN 'Startup' THEN 'C' WHEN 'Corporate' THEN 'D' ELSE "tier" END;--> statement-breakpoint
-- The AI rated these on the old scale: it rates them again (kept as is without an OpenAI key)
UPDATE "companies" SET "tier_source" = 'pending' WHERE "tier_source" = 'auto';--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tier_check" CHECK ("companies"."tier" in ('S', 'A', 'B', 'C', 'D'));
