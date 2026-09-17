import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { internshipEnrollments } from "./internship-enrollments";
import { tasks } from "./tasks";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.23 task_assignments
 * (Owner: BE-TSK | Basis: FR-LRN-038 / derived).
 *
 * A pure relation, not a state machine — no status/state_version column,
 * consistent with State & Workflow Spec v1.0 §3.3's "no invented Task state
 * machine" ruling. `UNIQUE(enrollment_id,task_id)` is the actual persisted
 * duplicate-assignment guard the application service relies on instead of
 * an ASSIGNED/UNASSIGNED status.
 */
export const taskAssignments = pgTable(
  "task_assignments",
  {
    ...primaryUuid,
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => internshipEnrollments.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    assignedByUserId: uuid("assigned_by_user_id")
      .notNull()
      .references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
  },
  (table) => [
    unique("task_assignments_enrollment_id_task_id_key").on(table.enrollmentId, table.taskId),
    index("task_assignments_enrollment_id_assigned_at_idx").on(
      table.enrollmentId,
      table.assignedAt,
    ),
    index("task_assignments_task_id_idx").on(table.taskId),
  ],
);

export type TaskAssignment = typeof taskAssignments.$inferSelect;
export type NewTaskAssignment = typeof taskAssignments.$inferInsert;
