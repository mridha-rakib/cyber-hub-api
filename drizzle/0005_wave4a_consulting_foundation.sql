CREATE TABLE "consulting_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consulting_request_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "consulting_requests_employer_status_submitted_idx";--> statement-breakpoint
ALTER TABLE "consulting_notes" ADD CONSTRAINT "consulting_notes_consulting_request_id_consulting_requests_id_fk" FOREIGN KEY ("consulting_request_id") REFERENCES "public"."consulting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulting_notes" ADD CONSTRAINT "consulting_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consulting_notes_consulting_request_id_idx" ON "consulting_notes" USING btree ("consulting_request_id");--> statement-breakpoint
CREATE INDEX "consulting_notes_author_user_id_idx" ON "consulting_notes" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "consulting_notes_created_at_idx" ON "consulting_notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "consulting_notes_request_created_desc_idx" ON "consulting_notes" USING btree ("consulting_request_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "security_scope_authorizations_confirmed_at_idx" ON "security_scope_authorizations" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "security_scope_authorizations_is_current_idx" ON "security_scope_authorizations" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "consulting_requests_employer_status_submitted_idx" ON "consulting_requests" USING btree ("employer_id","status","submitted_at" DESC NULLS LAST);