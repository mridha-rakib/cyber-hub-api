import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { completionEligibility } from "./enums";
import { internshipApplications } from "./internship-applications";
import { internships } from "./internships";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.21 internship_enrollments
 * (Owner: BE-INT | Basis: "WF completion gate / derived" | Release: MVP).
 *
 * Exact documented answer to "what persists when an application is
 * accepted": **"Operational learner-programme row created from accepted
 * application."** — a separate table, not a status flip on the application
 * row. Created transactionally by the WF-APP-03 (UNDER_REVIEW→ACCEPTED)
 * transition service; `applicationId` is UNIQUE, so acceptance can never
 * produce more than one enrollment per application.
 *
 * No `status` and no `state_version` column here — confirmed absent from
 * the ERD's own column list. `completionEligibility` is a computed gate
 * (State & Workflow Spec v1.0 §3.5), not a lifecycle state; there is no
 * named transition command that sets it, only a completion-evaluation
 * calculation (see the Internship module's `CompletionEligibilityService`).
 */
export const internshipEnrollments = pgTable(
  "internship_enrollments",
  {
    ...primaryUuid,
    applicationId: uuid("application_id")
      .notNull()
      .references(() => internshipApplications.id),
    internshipId: uuid("internship_id")
      .notNull()
      .references(() => internships.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // [SRC] "NOT_ELIGIBLE: Default." — State & Workflow Spec v1.0 §3.5.
    completionEligibility: completionEligibility("completion_eligibility")
      .notNull()
      .default("NOT_ELIGIBLE"),
    eligibilityEvaluatedAt: timestamp("eligibility_evaluated_at", { withTimezone: true }),
    eligibleAt: timestamp("eligible_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("internship_enrollments_application_id_key").on(table.applicationId),
    index("internship_enrollments_internship_id_idx").on(table.internshipId),
    index("internship_enrollments_user_id_idx").on(table.userId),
    index("internship_enrollments_user_internship_idx").on(table.userId, table.internshipId),
    index("internship_enrollments_internship_eligibility_idx").on(
      table.internshipId,
      table.completionEligibility,
    ),
  ],
);

export type InternshipEnrollment = typeof internshipEnrollments.$inferSelect;
export type NewInternshipEnrollment = typeof internshipEnrollments.$inferInsert;
