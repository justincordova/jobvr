ALTER TABLE "jobs" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
-- Jobs marked applied before this column existed: their last state change is the best guess
UPDATE "jobs" SET "applied_at" = "updated_at" WHERE "state" = 'applied';
