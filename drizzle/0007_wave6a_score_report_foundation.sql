CREATE TYPE "public"."report_status" AS ENUM('DRAFT', 'IN_REVIEW', 'READY_FOR_RELEASE', 'RELEASED', 'SUPERSEDED');--> statement-breakpoint
CREATE TABLE "security_report_findings" (
	"report_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"included_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_report_findings_report_id_finding_id_pk" PRIMARY KEY("report_id","finding_id")
);
--> statement-breakpoint
CREATE TABLE "security_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"employer_id" uuid NOT NULL,
	"draft_content" jsonb NOT NULL,
	"report_path" text,
	"status" "report_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"version_no" integer NOT NULL,
	"supersedes_report_id" uuid,
	"prepared_by_user_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"released_by_user_id" uuid,
	"generated_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_reports_assessment_version_key" UNIQUE("assessment_id","version_no"),
	CONSTRAINT "security_reports_version_no_check" CHECK ("security_reports"."version_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "security_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employer_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"overall_score" numeric(5, 2) NOT NULL,
	"website_security_score" numeric(5, 2),
	"network_security_score" numeric(5, 2),
	"email_security_score" numeric(5, 2),
	"authentication_security_score" numeric(5, 2),
	"employee_awareness_score" numeric(5, 2),
	"cloud_security_score" numeric(5, 2),
	"backup_recovery_score" numeric(5, 2),
	"methodology_version" text NOT NULL,
	"calculated_by_user_id" uuid,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_scores_overall_score_check" CHECK ("security_scores"."overall_score" >= 0 AND "security_scores"."overall_score" <= 100),
	CONSTRAINT "security_scores_website_security_score_check" CHECK ("security_scores"."website_security_score" >= 0 AND "security_scores"."website_security_score" <= 100),
	CONSTRAINT "security_scores_network_security_score_check" CHECK ("security_scores"."network_security_score" >= 0 AND "security_scores"."network_security_score" <= 100),
	CONSTRAINT "security_scores_email_security_score_check" CHECK ("security_scores"."email_security_score" >= 0 AND "security_scores"."email_security_score" <= 100),
	CONSTRAINT "security_scores_authentication_security_score_check" CHECK ("security_scores"."authentication_security_score" >= 0 AND "security_scores"."authentication_security_score" <= 100),
	CONSTRAINT "security_scores_employee_awareness_score_check" CHECK ("security_scores"."employee_awareness_score" >= 0 AND "security_scores"."employee_awareness_score" <= 100),
	CONSTRAINT "security_scores_cloud_security_score_check" CHECK ("security_scores"."cloud_security_score" >= 0 AND "security_scores"."cloud_security_score" <= 100),
	CONSTRAINT "security_scores_backup_recovery_score_check" CHECK ("security_scores"."backup_recovery_score" >= 0 AND "security_scores"."backup_recovery_score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "security_report_findings" ADD CONSTRAINT "security_report_findings_report_id_security_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."security_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_report_findings" ADD CONSTRAINT "security_report_findings_finding_id_vulnerability_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."vulnerability_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_reports" ADD CONSTRAINT "security_reports_assessment_id_security_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."security_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_reports" ADD CONSTRAINT "security_reports_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_reports" ADD CONSTRAINT "security_reports_supersedes_report_id_security_reports_id_fk" FOREIGN KEY ("supersedes_report_id") REFERENCES "public"."security_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_reports" ADD CONSTRAINT "security_reports_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_reports" ADD CONSTRAINT "security_reports_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_reports" ADD CONSTRAINT "security_reports_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scores" ADD CONSTRAINT "security_scores_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scores" ADD CONSTRAINT "security_scores_assessment_id_security_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."security_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scores" ADD CONSTRAINT "security_scores_calculated_by_user_id_users_id_fk" FOREIGN KEY ("calculated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_report_findings_report_sort_order_idx" ON "security_report_findings" USING btree ("report_id","sort_order");--> statement-breakpoint
CREATE INDEX "security_report_findings_finding_id_idx" ON "security_report_findings" USING btree ("finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_reports_report_path_unique" ON "security_reports" USING btree ("report_path") WHERE "security_reports"."report_path" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "security_reports_assessment_id_idx" ON "security_reports" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "security_reports_employer_id_idx" ON "security_reports" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "security_reports_status_idx" ON "security_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "security_reports_prepared_by_user_id_idx" ON "security_reports" USING btree ("prepared_by_user_id");--> statement-breakpoint
CREATE INDEX "security_reports_released_at_idx" ON "security_reports" USING btree ("released_at");--> statement-breakpoint
CREATE INDEX "security_reports_employer_status_released_desc_idx" ON "security_reports" USING btree ("employer_id","status","released_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "security_reports_prepared_by_status_idx" ON "security_reports" USING btree ("prepared_by_user_id","status");--> statement-breakpoint
CREATE INDEX "security_scores_employer_id_idx" ON "security_scores" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX "security_scores_assessment_id_idx" ON "security_scores" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "security_scores_methodology_version_idx" ON "security_scores" USING btree ("methodology_version");--> statement-breakpoint
CREATE INDEX "security_scores_calculated_at_idx" ON "security_scores" USING btree ("calculated_at");--> statement-breakpoint
CREATE INDEX "security_scores_employer_calculated_desc_idx" ON "security_scores" USING btree ("employer_id","calculated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "security_scores_assessment_calculated_desc_idx" ON "security_scores" USING btree ("assessment_id","calculated_at" DESC NULLS LAST);