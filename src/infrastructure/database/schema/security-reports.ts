import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employers } from "./employers";
import { reportStatus } from "./enums";
import { securityAssessments } from "./security-assessments";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.2 §7.33 security_reports
 * (Owner: BE-RPT | Basis: DR-016 + WF-RPT | Release: MVP v2).
 * "Client-facing report metadata and lifecycle; artifact file is private
 * stored_object."
 *
 * Persistence only (Wave 6A). The WF-RPT commands, the D6-5 guards, the
 * next-version_no assignment and the explicit API-RPT-009 supersede
 * transaction are Wave 6B; nothing here supersedes, releases or derives
 * Business visibility automatically (D6-8). draft_content is RESTRICTED
 * working content and is never a client projection; the released artifact
 * is the full client report (D6-4). The artifact itself lives in
 * stored_objects (GAP-013, Wave 7), which references this table — this
 * table has no storage FK.
 */
export const securityReports = pgTable(
  "security_reports",
  {
    ...primaryUuid,
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => securityAssessments.id),
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id),
    // RESTRICTED SECURITY (ERD §7.33): working report structure.
    draftContent: jsonb("draft_content").notNull(),
    // Stable application delivery path after artifact generation; never a
    // raw bucket URL. Populated only by the Wave 7 artifact pipeline.
    reportPath: text("report_path"),
    status: reportStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    versionNo: integer("version_no").notNull(),
    // Older report replaced by this version; set on the replacement only by
    // the explicit API-RPT-009 supersede transaction (Wave 6B).
    supersedesReportId: uuid("supersedes_report_id").references(
      (): AnyPgColumn => securityReports.id,
    ),
    preparedByUserId: uuid("prepared_by_user_id")
      .notNull()
      .references(() => users.id),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    releasedByUserId: uuid("released_by_user_id").references(() => users.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("security_reports_assessment_version_key").on(table.assessmentId, table.versionNo),
    uniqueIndex("security_reports_report_path_unique")
      .on(table.reportPath)
      .where(sql`${table.reportPath} IS NOT NULL`),
    index("security_reports_assessment_id_idx").on(table.assessmentId),
    index("security_reports_employer_id_idx").on(table.employerId),
    index("security_reports_status_idx").on(table.status),
    index("security_reports_prepared_by_user_id_idx").on(table.preparedByUserId),
    index("security_reports_released_at_idx").on(table.releasedAt),
    index("security_reports_employer_status_released_desc_idx").on(
      table.employerId,
      table.status,
      table.releasedAt.desc(),
    ),
    index("security_reports_prepared_by_status_idx").on(table.preparedByUserId, table.status),
    check("security_reports_version_no_check", sql`${table.versionNo} >= 1`),
  ],
);

export type SecurityReport = typeof securityReports.$inferSelect;
export type NewSecurityReport = typeof securityReports.$inferInsert;
