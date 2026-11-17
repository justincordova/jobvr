ALTER TABLE "companies" ADD CONSTRAINT "companies_tier_check" CHECK ("companies"."tier" in ('S', 'A', 'Mid', 'Startup', 'Corporate'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_status_check" CHECK ("companies"."status" in ('ok', 'needs_review', 'manual_only'));--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_precision_check" CHECK ("job_sources"."posted_at_precision" in ('instant', 'day'));--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_years_check" CHECK ("job_sources"."required_years" is null or "job_sources"."required_years" >= 0);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_state_check" CHECK ("jobs"."state" in ('new', 'saved', 'hidden', 'applied'));--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_state_check" CHECK ("suggestions"."state" in ('open', 'dismissed', 'added'));