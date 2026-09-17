CREATE TYPE "public"."application_status" AS ENUM('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."completion_eligibility" AS ENUM('NOT_ELIGIBLE', 'ELIGIBLE');--> statement-breakpoint
CREATE TYPE "public"."internship_status" AS ENUM('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REVISION_REQUIRED');--> statement-breakpoint
CREATE TABLE "internship_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internship_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "application_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"application_data" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_started_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewer_id" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internship_applications_state_version_check" CHECK ("internship_applications"."state_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "internship_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"internship_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"completion_eligibility" "completion_eligibility" DEFAULT 'NOT_ELIGIBLE' NOT NULL,
	"eligibility_evaluated_at" timestamp with time zone,
	"eligible_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internship_enrollments_application_id_key" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "internships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"duration" jsonb NOT NULL,
	"status" "internship_status" NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"completion_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internships_state_version_check" CHECK ("internships"."state_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "submission_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"evidence_text" text,
	"evidence_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_versions_submission_id_version_no_key" UNIQUE("submission_id","version_no"),
	CONSTRAINT "submission_versions_version_no_check" CHECK ("submission_versions"."version_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "submission_status" NOT NULL,
	"reviewer_id" uuid,
	"state_version" integer DEFAULT 1 NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_started_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"review_feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_task_assignment_id_key" UNIQUE("task_assignment_id"),
	CONSTRAINT "submissions_state_version_check" CHECK ("submissions"."state_version" >= 1),
	CONSTRAINT "submissions_current_version_check" CHECK ("submissions"."current_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	CONSTRAINT "task_assignments_enrollment_id_task_id_key" UNIQUE("enrollment_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internship_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"order_no" integer NOT NULL,
	"requirements" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_internship_id_order_no_key" UNIQUE("internship_id","order_no"),
	CONSTRAINT "tasks_order_no_check" CHECK ("tasks"."order_no" >= 0)
);
--> statement-breakpoint
ALTER TABLE "internship_applications" ADD CONSTRAINT "internship_applications_internship_id_internships_id_fk" FOREIGN KEY ("internship_id") REFERENCES "public"."internships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_applications" ADD CONSTRAINT "internship_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_applications" ADD CONSTRAINT "internship_applications_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_enrollments" ADD CONSTRAINT "internship_enrollments_application_id_internship_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."internship_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_enrollments" ADD CONSTRAINT "internship_enrollments_internship_id_internships_id_fk" FOREIGN KEY ("internship_id") REFERENCES "public"."internships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_enrollments" ADD CONSTRAINT "internship_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_assignment_id_task_assignments_id_fk" FOREIGN KEY ("task_assignment_id") REFERENCES "public"."task_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_enrollment_id_internship_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."internship_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_internship_id_internships_id_fk" FOREIGN KEY ("internship_id") REFERENCES "public"."internships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internship_applications_internship_id_idx" ON "internship_applications" USING btree ("internship_id");--> statement-breakpoint
CREATE INDEX "internship_applications_user_id_idx" ON "internship_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "internship_applications_status_idx" ON "internship_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internship_applications_reviewer_id_idx" ON "internship_applications" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "internship_applications_internship_status_submitted_idx" ON "internship_applications" USING btree ("internship_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "internship_applications_user_status_submitted_idx" ON "internship_applications" USING btree ("user_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "internship_enrollments_internship_id_idx" ON "internship_enrollments" USING btree ("internship_id");--> statement-breakpoint
CREATE INDEX "internship_enrollments_user_id_idx" ON "internship_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "internship_enrollments_user_internship_idx" ON "internship_enrollments" USING btree ("user_id","internship_id");--> statement-breakpoint
CREATE INDEX "internship_enrollments_internship_eligibility_idx" ON "internship_enrollments" USING btree ("internship_id","completion_eligibility");--> statement-breakpoint
CREATE INDEX "internships_status_idx" ON "internships" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internships_published_at_idx" ON "internships" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "internships_status_published_at_idx" ON "internships" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "submission_versions_submission_id_created_at_idx" ON "submission_versions" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_task_id_status_idx" ON "submissions" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "submissions_user_status_submitted_idx" ON "submissions" USING btree ("user_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "submissions_reviewer_status_submitted_idx" ON "submissions" USING btree ("reviewer_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "task_assignments_enrollment_id_assigned_at_idx" ON "task_assignments" USING btree ("enrollment_id","assigned_at");--> statement-breakpoint
CREATE INDEX "task_assignments_task_id_idx" ON "task_assignments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_internship_id_idx" ON "tasks" USING btree ("internship_id");