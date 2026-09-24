import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employers } from "./employers";
import { employerOpportunityType, listingStatus } from "./enums";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.10 employer_opportunities
 * (Owner: BE-EMP / BE-CAR | Basis: FR-BIZ-002-003 + WF-LST | Release: MVP).
 *
 * "Employer Portal internship opportunity / student project records
 * distinct from normal job listings." Shares the exact
 * `listing_status` moderation lifecycle with `jobs` (State & Workflow Spec
 * v1.0 §5) but is a separate table — `employer_id` is required here (every
 * row is ORG-owned; there is no external/admin-curated equivalent).
 */
export const employerOpportunities = pgTable(
  "employer_opportunities",
  {
    ...primaryUuid,
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    type: employerOpportunityType("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // [SRC] "Source-limited requirements payload."
    requirements: jsonb("requirements"),
    skills: text("skills").array(),
    applicationUrl: text("application_url"),
    status: listingStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    // [SRC] "Rejection/correction reason" — INTERNAL.
    moderationReason: text("moderation_reason"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employer_opportunities_employer_id_idx").on(table.employerId),
    index("employer_opportunities_created_by_user_id_idx").on(table.createdByUserId),
    index("employer_opportunities_type_idx").on(table.type),
    index("employer_opportunities_status_idx").on(table.status),
    index("employer_opportunities_published_at_idx").on(table.publishedAt),
    index("employer_opportunities_skills_gin_idx").using("gin", table.skills),
    index("employer_opportunities_employer_id_status_idx").on(table.employerId, table.status),
    index("employer_opportunities_type_status_published_at_idx").on(
      table.type,
      table.status,
      table.publishedAt,
    ),
    index("employer_opportunities_status_created_at_idx").on(table.status, table.createdAt),
    check("employer_opportunities_state_version_check", sql`${table.stateVersion} >= 1`),
  ],
);

export type EmployerOpportunity = typeof employerOpportunities.$inferSelect;
export type NewEmployerOpportunity = typeof employerOpportunities.$inferInsert;
