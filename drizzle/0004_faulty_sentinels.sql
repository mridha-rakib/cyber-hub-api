CREATE TYPE "public"."career_listing_type" AS ENUM('JOB', 'INTERNSHIP', 'GRADUATE_ROLE', 'APPRENTICESHIP');--> statement-breakpoint
CREATE TYPE "public"."employer_opportunity_type" AS ENUM('INTERNSHIP_OPPORTUNITY', 'STUDENT_PROJECT');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('SUBMITTED', 'UNDER_REVIEW', 'PUBLISHED', 'REJECTED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "employer_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"type" "employer_opportunity_type" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"requirements" jsonb,
	"skills" text[],
	"application_url" text,
	"status" "listing_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"moderation_reason" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employer_opportunities_state_version_check" CHECK ("employer_opportunities"."state_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"employer_name" text NOT NULL,
	"employer_id" uuid,
	"location" text NOT NULL,
	"level" text NOT NULL,
	"skills" text[] NOT NULL,
	"application_url" text NOT NULL,
	"listing_type" "career_listing_type" NOT NULL,
	"remote_uk" boolean DEFAULT false NOT NULL,
	"status" "listing_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"submitted_by_user_id" uuid,
	"moderation_reason" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_state_version_check" CHECK ("jobs"."state_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "employer_opportunities" ADD CONSTRAINT "employer_opportunities_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_opportunities" ADD CONSTRAINT "employer_opportunities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employer_opportunities_employer_id_idx" ON "employer_opportunities" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "employer_opportunities_created_by_user_id_idx" ON "employer_opportunities" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "employer_opportunities_type_idx" ON "employer_opportunities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "employer_opportunities_status_idx" ON "employer_opportunities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employer_opportunities_published_at_idx" ON "employer_opportunities" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "employer_opportunities_skills_gin_idx" ON "employer_opportunities" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "employer_opportunities_employer_id_status_idx" ON "employer_opportunities" USING btree ("employer_id","status");--> statement-breakpoint
CREATE INDEX "employer_opportunities_type_status_published_at_idx" ON "employer_opportunities" USING btree ("type","status","published_at");--> statement-breakpoint
CREATE INDEX "employer_opportunities_status_created_at_idx" ON "employer_opportunities" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_employer_id_idx" ON "jobs" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "jobs_location_idx" ON "jobs" USING btree ("location");--> statement-breakpoint
CREATE INDEX "jobs_level_idx" ON "jobs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "jobs_skills_gin_idx" ON "jobs" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "jobs_listing_type_idx" ON "jobs" USING btree ("listing_type");--> statement-breakpoint
CREATE INDEX "jobs_remote_uk_idx" ON "jobs" USING btree ("remote_uk");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_submitted_by_user_id_idx" ON "jobs" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX "jobs_published_at_idx" ON "jobs" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "jobs_status_published_at_idx" ON "jobs" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "jobs_location_level_status_idx" ON "jobs" USING btree ("location","level","status");--> statement-breakpoint
CREATE INDEX "jobs_employer_id_status_idx" ON "jobs" USING btree ("employer_id","status");--> statement-breakpoint
CREATE INDEX "jobs_listing_type_remote_uk_status_idx" ON "jobs" USING btree ("listing_type","remote_uk","status");