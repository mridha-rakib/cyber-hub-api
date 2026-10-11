CREATE TYPE "public"."finding_severity" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('OPEN', 'REMEDIATION_IN_PROGRESS', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "vulnerability_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"employer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"description" text,
	"evidence_summary" text,
	"recommendation" text NOT NULL,
	"status" "finding_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "security_assessments_employer_status_created_idx";--> statement-breakpoint
ALTER TABLE "vulnerability_findings" ADD CONSTRAINT "vulnerability_findings_assessment_id_security_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."security_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerability_findings" ADD CONSTRAINT "vulnerability_findings_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerability_findings" ADD CONSTRAINT "vulnerability_findings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vulnerability_findings_assessment_id_idx" ON "vulnerability_findings" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_employer_id_idx" ON "vulnerability_findings" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_severity_idx" ON "vulnerability_findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_status_idx" ON "vulnerability_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_created_by_user_id_idx" ON "vulnerability_findings" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_assessment_severity_status_idx" ON "vulnerability_findings" USING btree ("assessment_id","severity","status");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_employer_status_severity_idx" ON "vulnerability_findings" USING btree ("employer_id","status","severity");--> statement-breakpoint
CREATE INDEX "vulnerability_findings_created_by_created_desc_idx" ON "vulnerability_findings" USING btree ("created_by_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "security_assessments_employer_status_created_idx" ON "security_assessments" USING btree ("employer_id","status","created_at" DESC NULLS LAST);