ALTER TABLE "jobs" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_stage_check" CHECK ("jobs"."stage" in ('interviewing', 'offer', 'rejected'));