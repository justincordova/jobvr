CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text,
	"company_name" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"city" text,
	"state" text,
	"tier" text NOT NULL,
	"track" boolean DEFAULT false NOT NULL,
	"ats" text NOT NULL,
	"slug" text,
	"careers_url" text,
	"notes" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"job_id" text NOT NULL,
	"url" text NOT NULL,
	"url_key" text,
	"title" text NOT NULL,
	"category" text,
	"posted_at" timestamp with time zone NOT NULL,
	"posted_at_precision" text NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "job_sources_source_source_job_id_pk" PRIMARY KEY("source","source_job_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"company_name" text NOT NULL,
	"title" text NOT NULL,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"url" text NOT NULL,
	"primary_source" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"salary_min_usd" integer,
	"salary_max_usd" integer,
	"state" text DEFAULT 'new' NOT NULL,
	"baseline" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_visit_at" timestamp with time zone,
	"last_poll_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"last_cleanup_at" timestamp with time zone,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "source_state" (
	"key" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"company_id" uuid,
	"slug" text,
	"etag" text,
	"filters_hash" text,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"baselined_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"ats" text NOT NULL,
	"slug" text,
	"listing_count" integer DEFAULT 0 NOT NULL,
	"sample_titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_state" ADD CONSTRAINT "source_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_id_key" ON "applications" USING btree ("job_id") WHERE "applications"."job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_normalized_name_key" ON "companies" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ats_slug_key" ON "companies" USING btree ("ats",lower("slug")) WHERE "companies"."slug" is not null;--> statement-breakpoint
CREATE INDEX "job_sources_job_id_idx" ON "job_sources" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_sources_url_key_idx" ON "job_sources" USING btree ("url_key");--> statement-breakpoint
CREATE INDEX "jobs_effective_at_idx" ON "jobs" USING btree ("effective_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_unnotified_idx" ON "jobs" USING btree ("effective_at") WHERE "jobs"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "jobs_company_id_idx" ON "jobs" USING btree ("company_id");