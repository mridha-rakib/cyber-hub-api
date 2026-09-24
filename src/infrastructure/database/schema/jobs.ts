import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employers } from "./employers";
import { careerListingType, listingStatus } from "./enums";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.9 jobs
 * (Owner: BE-CAR | Basis: DR-005 + WF-LST | Release: MVP).
 *
 * "UK career listing including externally curated and employer-submitted
 * moderated listings." `employer_id` is nullable — null for
 * external/admin-curated listings, set for employer-submitted ones (ORG
 * owner). `application_url` is the documented interaction mechanism: no
 * internal application/tracking entity is defined for this table, learners
 * are redirected via API-CAR-003's validated outbound endpoint.
 */
export const jobs = pgTable(
  "jobs",
  {
    ...primaryUuid,
    title: text("title").notNull(),
    employerName: text("employer_name").notNull(),
    employerId: uuid("employer_id").references(() => employers.id),
    location: text("location").notNull(),
    level: text("level").notNull(),
    skills: text("skills").array().notNull(),
    applicationUrl: text("application_url").notNull(),
    listingType: careerListingType("listing_type").notNull(),
    remoteUk: boolean("remote_uk").notNull().default(false),
    status: listingStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
    // [SRC] "Rejection/correction reason" — INTERNAL.
    moderationReason: text("moderation_reason"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_employer_id_idx").on(table.employerId),
    index("jobs_location_idx").on(table.location),
    index("jobs_level_idx").on(table.level),
    index("jobs_skills_gin_idx").using("gin", table.skills),
    index("jobs_listing_type_idx").on(table.listingType),
    index("jobs_remote_uk_idx").on(table.remoteUk),
    index("jobs_status_idx").on(table.status),
    index("jobs_submitted_by_user_id_idx").on(table.submittedByUserId),
    index("jobs_published_at_idx").on(table.publishedAt),
    index("jobs_status_published_at_idx").on(table.status, table.publishedAt),
    index("jobs_location_level_status_idx").on(table.location, table.level, table.status),
    index("jobs_employer_id_status_idx").on(table.employerId, table.status),
    index("jobs_listing_type_remote_uk_status_idx").on(
      table.listingType,
      table.remoteUk,
      table.status,
    ),
    check("jobs_state_version_check", sql`${table.stateVersion} >= 1`),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
