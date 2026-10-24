CREATE TYPE "public"."content_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."course_approval_status" AS ENUM('DRAFT', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"level" text NOT NULL,
	"original_price" numeric(12, 2) NOT NULL,
	"discounted_price" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"external_url" text NOT NULL,
	"expires_at" timestamp with time zone,
	"affiliate_disclosure" text,
	"has_affiliate_relationship" boolean,
	"verification_note" text,
	"rejection_reason" text,
	"approval_status" "course_approval_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_original_price_check" CHECK ("courses"."original_price" >= 0),
	CONSTRAINT "courses_discounted_price_check" CHECK ("courses"."discounted_price" >= 0),
	CONSTRAINT "courses_currency_check" CHECK ("courses"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "courses_external_url_https_check" CHECK ("courses"."external_url" ~ '^https://'),
	CONSTRAINT "courses_affiliate_disclosure_check" CHECK ("courses"."has_affiliate_relationship" IS DISTINCT FROM true OR length(btrim(coalesce("courses"."affiliate_disclosure", ''))) > 0),
	CONSTRAINT "courses_approved_affiliate_declared_check" CHECK ("courses"."approval_status" <> 'APPROVED' OR "courses"."has_affiliate_relationship" IS NOT NULL),
	CONSTRAINT "courses_rejected_reason_check" CHECK ("courses"."approval_status" <> 'REJECTED' OR length(btrim(coalesce("courses"."rejection_reason", ''))) > 0),
	CONSTRAINT "courses_verification_note_length_check" CHECK ("courses"."verification_note" IS NULL OR length("courses"."verification_note") <= 2000),
	CONSTRAINT "courses_rejection_reason_length_check" CHECK ("courses"."rejection_reason" IS NULL OR length("courses"."rejection_reason") <= 1000),
	CONSTRAINT "courses_state_version_check" CHECK ("courses"."state_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] NOT NULL,
	"content" jsonb NOT NULL,
	"status" "content_status" NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_state_version_check" CHECK ("resources"."state_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX "courses_approval_status_expires_at_idx" ON "courses" USING btree ("approval_status","expires_at");--> statement-breakpoint
CREATE INDEX "courses_category_level_status_idx" ON "courses" USING btree ("category","level","approval_status");--> statement-breakpoint
CREATE INDEX "courses_provider_status_idx" ON "courses" USING btree ("provider","approval_status");--> statement-breakpoint
CREATE INDEX "courses_status_created_at_id_idx" ON "courses" USING btree ("approval_status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "resources_status_published_at_idx" ON "resources" USING btree ("status","published_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "resources_category_status_idx" ON "resources" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "resources_tags_gin_idx" ON "resources" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "resources_featured_status_idx" ON "resources" USING btree ("featured","status");--> statement-breakpoint
CREATE INDEX "resources_status_featured_published_id_idx" ON "resources" USING btree ("status","featured" DESC NULLS FIRST,"published_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "resources_created_at_id_idx" ON "resources" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);