import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employers } from "./employers";
import { securityAssessments } from "./security-assessments";
import { users } from "./users";

/** ERD §7.32: every score is numeric(5,2) on the 0-100 scale. */
const scoreColumn = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * Database ERD & Data Dictionary v2.2 §7.32 security_scores
 * (Owner: BE-SCR | Basis: DR-015 | Release: MVP prototype).
 * "Immutable Business Security Score snapshot for one assessment."
 *
 * Insert-only history (DB2-DEC-011): an assessment may carry any number of
 * snapshots and recalculation inserts a new row, so there is deliberately no
 * uniqueness on assessment_id and no state_version. Persistence only (Wave
 * 6A): no formula, weighting, band or methodology exists here — GAP-009
 * stays open and API-SCR-001 writes no row without an approved methodology.
 * Business visibility is derived from released reports (D6-2), never from a
 * column on this table.
 */
export const securityScores = pgTable(
  "security_scores",
  {
    ...primaryUuid,
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => securityAssessments.id),
    overallScore: scoreColumn("overall_score").notNull(),
    websiteSecurityScore: scoreColumn("website_security_score"),
    networkSecurityScore: scoreColumn("network_security_score"),
    emailSecurityScore: scoreColumn("email_security_score"),
    authenticationSecurityScore: scoreColumn("authentication_security_score"),
    employeeAwarenessScore: scoreColumn("employee_awareness_score"),
    cloudSecurityScore: scoreColumn("cloud_security_score"),
    backupRecoveryScore: scoreColumn("backup_recovery_score"),
    methodologyVersion: text("methodology_version").notNull(),
    calculatedByUserId: uuid("calculated_by_user_id").references(() => users.id),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("security_scores_employer_id_idx").on(table.employerId),
    index("security_scores_assessment_id_idx").on(table.assessmentId),
    index("security_scores_methodology_version_idx").on(table.methodologyVersion),
    index("security_scores_calculated_at_idx").on(table.calculatedAt),
    index("security_scores_employer_calculated_desc_idx").on(
      table.employerId,
      table.calculatedAt.desc(),
    ),
    index("security_scores_assessment_calculated_desc_idx").on(
      table.assessmentId,
      table.calculatedAt.desc(),
    ),
    check(
      "security_scores_overall_score_check",
      sql`${table.overallScore} >= 0 AND ${table.overallScore} <= 100`,
    ),
    check(
      "security_scores_website_security_score_check",
      sql`${table.websiteSecurityScore} >= 0 AND ${table.websiteSecurityScore} <= 100`,
    ),
    check(
      "security_scores_network_security_score_check",
      sql`${table.networkSecurityScore} >= 0 AND ${table.networkSecurityScore} <= 100`,
    ),
    check(
      "security_scores_email_security_score_check",
      sql`${table.emailSecurityScore} >= 0 AND ${table.emailSecurityScore} <= 100`,
    ),
    check(
      "security_scores_authentication_security_score_check",
      sql`${table.authenticationSecurityScore} >= 0 AND ${table.authenticationSecurityScore} <= 100`,
    ),
    check(
      "security_scores_employee_awareness_score_check",
      sql`${table.employeeAwarenessScore} >= 0 AND ${table.employeeAwarenessScore} <= 100`,
    ),
    check(
      "security_scores_cloud_security_score_check",
      sql`${table.cloudSecurityScore} >= 0 AND ${table.cloudSecurityScore} <= 100`,
    ),
    check(
      "security_scores_backup_recovery_score_check",
      sql`${table.backupRecoveryScore} >= 0 AND ${table.backupRecoveryScore} <= 100`,
    ),
  ],
);

export type SecurityScore = typeof securityScores.$inferSelect;
export type NewSecurityScore = typeof securityScores.$inferInsert;
