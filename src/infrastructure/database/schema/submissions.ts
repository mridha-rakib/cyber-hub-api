import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { submissionStatus } from "./enums";
import { taskAssignments } from "./task-assignments";
import { tasks } from "./tasks";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.24 submissions
 * (Owner: BE-SUB | Basis: DR-008 + WF-SUB).
 *
 * `UNIQUE(task_assignment_id)` — one submission per assigned task; revision
 * history lives in `submission_versions`, not multiple submission rows.
 * WF-SUB-01..05 (already registered in the Wave 0D-6 workflow registry)
 * drive every status change from here on; `status` has no DB default, the
 * creating service always sets it to SUBMITTED explicitly.
 */
export const submissions = pgTable(
  "submissions",
  {
    ...primaryUuid,
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    taskAssignmentId: uuid("task_assignment_id")
      .notNull()
      .references(() => taskAssignments.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: submissionStatus("status").notNull(),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    stateVersion: integer("state_version").notNull().default(1),
    currentVersion: integer("current_version").notNull().default(1),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // [SRC] "Required for REVISION_REQUIRED; learner-visible" — CONFIDENTIAL.
    reviewFeedback: text("review_feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("submissions_task_assignment_id_key").on(table.taskAssignmentId),
    index("submissions_task_id_status_idx").on(table.taskId, table.status),
    index("submissions_user_status_submitted_idx").on(
      table.userId,
      table.status,
      table.submittedAt,
    ),
    index("submissions_reviewer_status_submitted_idx").on(
      table.reviewerId,
      table.status,
      table.submittedAt,
    ),
    check("submissions_state_version_check", sql`${table.stateVersion} >= 1`),
    check("submissions_current_version_check", sql`${table.currentVersion} >= 1`),
  ],
);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
