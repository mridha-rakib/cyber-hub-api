CREATE TYPE "public"."assessment_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."consulting_status" AS ENUM('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."security_service_type" AS ENUM('WEBSITE_ASSESSMENT', 'NETWORK_ASSESSMENT', 'VULNERABILITY_ASSESSMENT', 'PHISHING_AWARENESS', 'CLOUD_REVIEW', 'CYBER_RISK_ASSESSMENT', 'SECURITY_DOCUMENTATION');--> statement-breakpoint
CREATE TABLE "consulting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"company_details" jsonb NOT NULL,
	"business_size" text NOT NULL,
	"security_concern" text NOT NULL,
	"business_impact" text,
	"requested_service" "security_service_type" NOT NULL,
	"environment_details" jsonb,
	"contact_information" jsonb NOT NULL,
	"status" "consulting_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"assigned_consultant_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"consulting_request_id" uuid NOT NULL,
	"scope_authorization_id" uuid NOT NULL,
	"service" "security_service_type" NOT NULL,
	"scope_snapshot" jsonb NOT NULL,
	"assigned_consultant_id" uuid NOT NULL,
	"status" "assessment_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_scope_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consulting_request_id" uuid NOT NULL,
	"employer_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"authorized_targets" jsonb NOT NULL,
	"allowed_activities" jsonb NOT NULL,
	"restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"superseded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_scope_authorizations_request_version_key" UNIQUE("consulting_request_id","version_no"),
	CONSTRAINT "security_scope_authorizations_version_no_check" CHECK ("security_scope_authorizations"."version_no" >= 1)
);
--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_requests" ADD CONSTRAINT "consulting_requests_assigned_consultant_id_users_id_fk" FOREIGN KEY ("assigned_consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_assessments" ADD CONSTRAINT "security_assessments_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_assessments" ADD CONSTRAINT "security_assessments_consulting_request_id_consulting_requests_id_fk" FOREIGN KEY ("consulting_request_id") REFERENCES "public"."consulting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_assessments" ADD CONSTRAINT "security_assessments_scope_authorization_id_security_scope_authorizations_id_fk" FOREIGN KEY ("scope_authorization_id") REFERENCES "public"."security_scope_authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_assessments" ADD CONSTRAINT "security_assessments_assigned_consultant_id_users_id_fk" FOREIGN KEY ("assigned_consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scope_authorizations" ADD CONSTRAINT "security_scope_authorizations_consulting_request_id_consulting_requests_id_fk" FOREIGN KEY ("consulting_request_id") REFERENCES "public"."consulting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scope_authorizations" ADD CONSTRAINT "security_scope_authorizations_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scope_authorizations" ADD CONSTRAINT "security_scope_authorizations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consulting_requests_employer_id_idx" ON "consulting_requests" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "consulting_requests_submitted_by_user_id_idx" ON "consulting_requests" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX "consulting_requests_requested_service_idx" ON "consulting_requests" USING btree ("requested_service");--> statement-breakpoint
CREATE INDEX "consulting_requests_status_idx" ON "consulting_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consulting_requests_assigned_consultant_id_idx" ON "consulting_requests" USING btree ("assigned_consultant_id");--> statement-breakpoint
CREATE INDEX "consulting_requests_submitted_at_idx" ON "consulting_requests" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "consulting_requests_employer_status_submitted_idx" ON "consulting_requests" USING btree ("employer_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "consulting_requests_assigned_consultant_status_idx" ON "consulting_requests" USING btree ("assigned_consultant_id","status");--> statement-breakpoint
CREATE INDEX "consulting_requests_status_submitted_idx" ON "consulting_requests" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "security_assessments_consulting_request_id_idx" ON "security_assessments" USING btree ("consulting_request_id");--> statement-breakpoint
CREATE INDEX "security_assessments_scope_authorization_id_idx" ON "security_assessments" USING btree ("scope_authorization_id");--> statement-breakpoint
CREATE INDEX "security_assessments_assigned_consultant_id_idx" ON "security_assessments" USING btree ("assigned_consultant_id");--> statement-breakpoint
CREATE INDEX "security_assessments_service_idx" ON "security_assessments" USING btree ("service");--> statement-breakpoint
CREATE INDEX "security_assessments_status_idx" ON "security_assessments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "security_assessments_started_at_idx" ON "security_assessments" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "security_assessments_employer_status_created_idx" ON "security_assessments" USING btree ("employer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "security_assessments_assigned_consultant_status_idx" ON "security_assessments" USING btree ("assigned_consultant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "security_scope_authorizations_current_unique" ON "security_scope_authorizations" USING btree ("consulting_request_id") WHERE "security_scope_authorizations"."is_current" = true AND "security_scope_authorizations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "security_scope_authorizations_employer_current_idx" ON "security_scope_authorizations" USING btree ("employer_id","is_current");--> statement-breakpoint
CREATE INDEX "security_scope_authorizations_consulting_request_id_idx" ON "security_scope_authorizations" USING btree ("consulting_request_id");