CREATE TYPE "public"."certificate_status" AS ENUM('ISSUED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"certificate_number" text NOT NULL,
	"verification_path" text NOT NULL,
	"status" "certificate_status" NOT NULL,
	"recipient_name_snapshot" text NOT NULL,
	"programme_title_snapshot" text NOT NULL,
	"completed_skills" text[] NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_enrollment_id_key" UNIQUE("enrollment_id"),
	CONSTRAINT "certificates_certificate_number_key" UNIQUE("certificate_number"),
	CONSTRAINT "certificates_verification_path_key" UNIQUE("verification_path")
);
--> statement-breakpoint
CREATE TABLE "portfolio_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"internship_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_certificates" (
	"portfolio_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_certificates_portfolio_id_certificate_id_pk" PRIMARY KEY("portfolio_id","certificate_id")
);
--> statement-breakpoint
CREATE TABLE "portfolio_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"title" text NOT NULL,
	"issuer" text,
	"credential_url" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"links" text[] DEFAULT '{}' NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "portfolio_skills_portfolio_id_name_key" UNIQUE("portfolio_id","name")
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"public_slug" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "portfolios_public_slug_key" UNIQUE("public_slug")
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_programme_id_internships_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."internships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_internship_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."internship_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_achievements" ADD CONSTRAINT "portfolio_achievements_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_achievements" ADD CONSTRAINT "portfolio_achievements_internship_id_internships_id_fk" FOREIGN KEY ("internship_id") REFERENCES "public"."internships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_certificates" ADD CONSTRAINT "portfolio_certificates_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_certificates" ADD CONSTRAINT "portfolio_certificates_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_certifications" ADD CONSTRAINT "portfolio_certifications_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_evidence" ADD CONSTRAINT "portfolio_evidence_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_links" ADD CONSTRAINT "portfolio_links_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_projects" ADD CONSTRAINT "portfolio_projects_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_skills" ADD CONSTRAINT "portfolio_skills_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificates_user_id_issued_at_idx" ON "certificates" USING btree ("user_id","issued_at");--> statement-breakpoint
CREATE INDEX "certificates_status_idx" ON "certificates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "portfolio_achievements_portfolio_id_is_public_sort_order_idx" ON "portfolio_achievements" USING btree ("portfolio_id","is_public","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_achievements_internship_id_idx" ON "portfolio_achievements" USING btree ("internship_id");--> statement-breakpoint
CREATE INDEX "portfolio_certificates_portfolio_id_is_public_sort_order_idx" ON "portfolio_certificates" USING btree ("portfolio_id","is_public","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_certifications_portfolio_id_is_public_sort_order_idx" ON "portfolio_certifications" USING btree ("portfolio_id","is_public","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_evidence_portfolio_id_is_public_sort_order_idx" ON "portfolio_evidence" USING btree ("portfolio_id","is_public","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_links_portfolio_id_sort_order_idx" ON "portfolio_links" USING btree ("portfolio_id","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_links_portfolio_id_is_public_idx" ON "portfolio_links" USING btree ("portfolio_id","is_public");--> statement-breakpoint
CREATE INDEX "portfolio_projects_portfolio_id_sort_order_idx" ON "portfolio_projects" USING btree ("portfolio_id","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_projects_portfolio_id_is_public_idx" ON "portfolio_projects" USING btree ("portfolio_id","is_public");--> statement-breakpoint
CREATE INDEX "portfolio_projects_skills_gin_idx" ON "portfolio_projects" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "portfolio_skills_portfolio_id_is_public_sort_order_idx" ON "portfolio_skills" USING btree ("portfolio_id","is_public","sort_order");--> statement-breakpoint
CREATE INDEX "portfolios_is_public_public_slug_idx" ON "portfolios" USING btree ("is_public","public_slug");