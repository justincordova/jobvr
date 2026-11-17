ALTER TABLE "settings" ADD COLUMN "last_poll_ok_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "poll_stall_alert_at" timestamp with time zone;--> statement-breakpoint
-- Existing installs: the latest poll start is the best guess at the latest success
UPDATE "settings" SET "last_poll_ok_at" = "last_poll_at";
