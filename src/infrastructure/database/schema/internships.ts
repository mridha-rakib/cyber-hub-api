import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { internshipStatus } from "./enums";

/**
 * Database ERD & Data Dictionary v2.0 §7.19 internships
 * (Owner: BE-INT | Basis: DR-006 + WF-PRG | Release: MVP).
 *
 * Wave 1 (Internship Core Vertical Slice): the programme catalogue entity.
 * `status` has no DB default — the row is always inserted with an explicit
 * status by the application service (DRAFT on create; publication lifecycle
 * commands WF-PRG-01..04, already registered in
 * `core/workflow/workflow-registry.ts`, drive every state change from
 * there). Creation itself is an ordinary insert, not a workflow transition
 * — the registry's `InternshipProgramme` definition has no `from: []` row.
 */
export const internships = pgTable(
  "internships",
  {
    ...primaryUuid,
    title: text("title").notNull(),
    description: text("description").notNull(),
    // [SRC] "leaf structure is admin-configured/source-limited" — ERD §7.19.
    requirements: jsonb("requirements").notNull(),
    duration: jsonb("duration").notNull(),
    status: internshipStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    completionCriteria: jsonb("completion_criteria").notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("internships_status_idx").on(table.status),
    index("internships_published_at_idx").on(table.publishedAt),
    index("internships_status_published_at_idx").on(table.status, table.publishedAt),
    check("internships_state_version_check", sql`${table.stateVersion} >= 1`),
  ],
);

export type Internship = typeof internships.$inferSelect;
export type NewInternship = typeof internships.$inferInsert;
