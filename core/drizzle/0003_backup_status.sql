ALTER TABLE "settings" ADD COLUMN "last_backup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_error" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_alert_at" timestamp with time zone;