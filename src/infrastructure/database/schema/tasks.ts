import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { internships } from "./internships";

/**
 * Database ERD & Data Dictionary v2.0 §7.22 tasks (Owner: BE-TSK | Basis: DR-007).
 *
 * No `status`/lifecycle column — tasks have no source-defined status field.
 * State & Workflow Spec v1.0 §3.3 ("Task Assignment Gate") is explicit that
 * this is deliberate: *"Task itself is not given a source-defined status
 * field, so this document does not invent a full Task state machine."* Task
 * visibility/assignment is governed by the `task_assignments` relation
 * table, not by any status here.
 */
export const tasks = pgTable(
  "tasks",
  {
    ...primaryUuid,
    internshipId: uuid("internship_id")
      .notNull()
      .references(() => internships.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    orderNo: integer("order_no").notNull(),
    // [SRC] "Evidence/completion requirements" — ERD §7.22.
    requirements: jsonb("requirements").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tasks_internship_id_order_no_key").on(table.internshipId, table.orderNo),
    index("tasks_internship_id_idx").on(table.internshipId),
    check("tasks_order_no_check", sql`${table.orderNo} >= 0`),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
