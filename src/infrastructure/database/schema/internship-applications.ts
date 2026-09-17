import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { applicationStatus } from "./enums";
import { internships } from "./internships";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.20 internship_applications
 * (Owner: BE-INT | Basis: WF-APP / FR-LRN-037).
 *
 * Implementation note transcribed exactly from the ERD: **"No
 * UNIQUE(user_id,internship_id) until duplicate/reapplication policy is
 * explicitly approved."** Do not add that constraint — the source
 * explicitly defers the duplicate-application policy question.
 */
export const internshipApplications = pgTable(
  "internship_applications",
  {
    ...primaryUuid,
    internshipId: uuid("internship_id")
      .notNull()
      .references(() => internships.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: applicationStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    // [SRC] "answers/attachments metadata; exact questions come from
    // UI/API contract" — ERD §7.20, marked CONFIDENTIAL.
    applicationData: jsonb("application_data").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    // [SRC] "Required for rejection; optional internal decision note" — INTERNAL.
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("internship_applications_internship_id_idx").on(table.internshipId),
    index("internship_applications_user_id_idx").on(table.userId),
    index("internship_applications_status_idx").on(table.status),
    index("internship_applications_reviewer_id_idx").on(table.reviewerId),
    index("internship_applications_internship_status_submitted_idx").on(
      table.internshipId,
      table.status,
      table.submittedAt,
    ),
    index("internship_applications_user_status_submitted_idx").on(
      table.userId,
      table.status,
      table.submittedAt,
    ),
    check("internship_applications_state_version_check", sql`${table.stateVersion} >= 1`),
  ],
);

export type InternshipApplication = typeof internshipApplications.$inferSelect;
export type NewInternshipApplication = typeof internshipApplications.$inferInsert;
