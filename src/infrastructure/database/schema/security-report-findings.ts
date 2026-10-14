import { index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { securityReports } from "./security-reports";
import { vulnerabilityFindings } from "./vulnerability-findings";

/**
 * Database ERD & Data Dictionary v2.2 §7.34 security_report_findings
 * (Owner: BE-RPT | Basis: relational normalization of report finding
 * membership | Release: MVP v2). "N:M membership of findings included in
 * report."
 *
 * Live reference rows only (D6-7): no finding content is copied here, so
 * Business JSON views read current vulnerability_findings values while the
 * released artifact remains the historical record. The same
 * assessment/employer rule and the DRAFT-only membership rule are service
 * validations in the report transaction (ERD §8, §10) — Wave 6B.
 */
export const securityReportFindings = pgTable(
  "security_report_findings",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => securityReports.id),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => vulnerabilityFindings.id),
    sortOrder: integer("sort_order").notNull().default(0),
    includedAt: timestamp("included_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.reportId, table.findingId] }),
    index("security_report_findings_report_sort_order_idx").on(table.reportId, table.sortOrder),
    index("security_report_findings_finding_id_idx").on(table.findingId),
  ],
);

export type SecurityReportFinding = typeof securityReportFindings.$inferSelect;
export type NewSecurityReportFinding = typeof securityReportFindings.$inferInsert;
