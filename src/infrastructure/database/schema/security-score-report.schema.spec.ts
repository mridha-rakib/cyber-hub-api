import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { getWorkflowDefinition } from "../../../core/workflow/workflow-registry";
import { reportStatus } from "./enums";
import { securityAssessments } from "./security-assessments";
import { securityReportFindings } from "./security-report-findings";
import { securityReports } from "./security-reports";
import { securityScores } from "./security-scores";
import { vulnerabilityFindings } from "./vulnerability-findings";

function columnNames(table: PgTable) {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

function foreignKeysOf(table: PgTable) {
  return getTableConfig(table).foreignKeys.map((fk) => {
    const reference = fk.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableName(reference.foreignTable),
      onDelete: fk.onDelete,
    };
  });
}

function indexNamesOf(table: PgTable) {
  return getTableConfig(table)
    .indexes.map((index) => index.config.name)
    .sort();
}

describe("Wave 6A security score + report persistence schema (ERD v2.2 §7.32-7.34)", () => {
  it("uses the exact ERD §6 report_status enum, matching the WF-RPT registry states", () => {
    expect(reportStatus.enumName).toBe("report_status");
    expect(reportStatus.enumValues).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "READY_FOR_RELEASE",
      "RELEASED",
      "SUPERSEDED",
    ]);
    expect(getWorkflowDefinition("Report").states).toEqual(reportStatus.enumValues);
  });

  it("defines exactly the ERD §7.32 security_scores columns with numeric(5,2) scores", () => {
    expect(getTableName(securityScores)).toBe("security_scores");
    expect(columnNames(securityScores)).toEqual([
      "id",
      "employer_id",
      "assessment_id",
      "overall_score",
      "website_security_score",
      "network_security_score",
      "email_security_score",
      "authentication_security_score",
      "employee_awareness_score",
      "cloud_security_score",
      "backup_recovery_score",
      "methodology_version",
      "calculated_by_user_id",
      "calculated_at",
    ]);
    const columns = getTableColumns(securityScores);
    for (const required of [
      columns.employerId,
      columns.assessmentId,
      columns.overallScore,
      columns.methodologyVersion,
      columns.calculatedAt,
    ]) {
      expect(required.notNull).toBe(true);
    }
    for (const optional of [
      columns.websiteSecurityScore,
      columns.networkSecurityScore,
      columns.emailSecurityScore,
      columns.authenticationSecurityScore,
      columns.employeeAwarenessScore,
      columns.cloudSecurityScore,
      columns.backupRecoveryScore,
      columns.calculatedByUserId,
    ]) {
      expect(optional.notNull).toBe(false);
    }
    for (const score of [
      columns.overallScore,
      columns.websiteSecurityScore,
      columns.backupRecoveryScore,
    ]) {
      expect(score.getSQLType()).toBe("numeric(5, 2)");
    }
    expect(columns.calculatedAt.hasDefault).toBe(true);
    // Methodology is chosen by an approved GAP-009 version, never defaulted.
    expect(columns.methodologyVersion.hasDefault).toBe(false);
  });

  it("keeps score snapshots insert-only history: no state_version and no per-assessment uniqueness", () => {
    expect(columnNames(securityScores)).not.toContain("state_version");
    const config = getTableConfig(securityScores);
    expect(config.uniqueConstraints).toEqual([]);
    expect(config.indexes.filter((index) => index.config.unique)).toEqual([]);
  });

  it("bounds every score to 0-100 through named CHECK constraints", () => {
    expect(
      getTableConfig(securityScores)
        .checks.map((check) => check.name)
        .sort(),
    ).toEqual(
      [
        "security_scores_overall_score_check",
        "security_scores_website_security_score_check",
        "security_scores_network_security_score_check",
        "security_scores_email_security_score_check",
        "security_scores_authentication_security_score_check",
        "security_scores_employee_awareness_score_check",
        "security_scores_cloud_security_score_check",
        "security_scores_backup_recovery_score_check",
      ].sort(),
    );
  });

  it("defines exactly the ERD §7.33 security_reports columns", () => {
    expect(getTableName(securityReports)).toBe("security_reports");
    expect(columnNames(securityReports)).toEqual([
      "id",
      "assessment_id",
      "employer_id",
      "draft_content",
      "report_path",
      "status",
      "state_version",
      "version_no",
      "supersedes_report_id",
      "prepared_by_user_id",
      "reviewed_by_user_id",
      "released_by_user_id",
      "generated_at",
      "released_at",
      "created_at",
      "updated_at",
    ]);
    const columns = getTableColumns(securityReports);
    for (const required of [
      columns.assessmentId,
      columns.employerId,
      columns.draftContent,
      columns.status,
      columns.stateVersion,
      columns.versionNo,
      columns.preparedByUserId,
      columns.createdAt,
      columns.updatedAt,
    ]) {
      expect(required.notNull).toBe(true);
    }
    for (const optional of [
      columns.reportPath,
      columns.supersedesReportId,
      columns.reviewedByUserId,
      columns.releasedByUserId,
      columns.generatedAt,
      columns.releasedAt,
    ]) {
      expect(optional.notNull).toBe(false);
    }
    expect(columns.stateVersion.default).toBe(1);
    // Status and version are chosen by the WF-RPT-01 command (Wave 6B); no
    // database default may silently pick a lifecycle state or version.
    expect(columns.status.hasDefault).toBe(false);
    expect(columns.versionNo.hasDefault).toBe(false);
    expect(columns.draftContent.getSQLType()).toBe("jsonb");
  });

  it("carries the ERD report versioning and delivery-path uniqueness", () => {
    const config = getTableConfig(securityReports);
    expect(
      config.uniqueConstraints.map((unique) => ({
        name: unique.name,
        columns: unique.columns.map((column) => column.name),
      })),
    ).toEqual([
      { name: "security_reports_assessment_version_key", columns: ["assessment_id", "version_no"] },
    ]);
    const pathIndex = config.indexes.find(
      (index) => index.config.name === "security_reports_report_path_unique",
    );
    expect(pathIndex?.config.unique).toBe(true);
    expect(pathIndex?.config.where).toBeDefined();
    expect(config.checks.map((check) => check.name)).toEqual(["security_reports_version_no_check"]);
  });

  it("defines exactly the ERD §7.34 security_report_findings membership columns and key", () => {
    expect(getTableName(securityReportFindings)).toBe("security_report_findings");
    expect(columnNames(securityReportFindings)).toEqual([
      "report_id",
      "finding_id",
      "sort_order",
      "included_at",
    ]);
    const columns = getTableColumns(securityReportFindings);
    expect(columns.sortOrder.default).toBe(0);
    expect(columns.includedAt.hasDefault).toBe(true);
    const [primaryKey] = getTableConfig(securityReportFindings).primaryKeys;
    expect(primaryKey.columns.map((column) => column.name)).toEqual(["report_id", "finding_id"]);
  });

  it("references every parent by non-cascading foreign key (ERD §5 governed delete behaviour)", () => {
    expect(foreignKeysOf(securityScores)).toEqual(
      expect.arrayContaining([
        { columns: ["employer_id"], foreignTable: "employers", onDelete: "no action" },
        { columns: ["assessment_id"], foreignTable: "security_assessments", onDelete: "no action" },
        { columns: ["calculated_by_user_id"], foreignTable: "users", onDelete: "no action" },
      ]),
    );
    expect(foreignKeysOf(securityScores)).toHaveLength(3);
    expect(foreignKeysOf(securityReports)).toEqual(
      expect.arrayContaining([
        { columns: ["assessment_id"], foreignTable: "security_assessments", onDelete: "no action" },
        { columns: ["employer_id"], foreignTable: "employers", onDelete: "no action" },
        {
          columns: ["supersedes_report_id"],
          foreignTable: "security_reports",
          onDelete: "no action",
        },
        { columns: ["prepared_by_user_id"], foreignTable: "users", onDelete: "no action" },
        { columns: ["reviewed_by_user_id"], foreignTable: "users", onDelete: "no action" },
        { columns: ["released_by_user_id"], foreignTable: "users", onDelete: "no action" },
      ]),
    );
    expect(foreignKeysOf(securityReports)).toHaveLength(6);
    expect(foreignKeysOf(securityReportFindings)).toEqual([
      { columns: ["report_id"], foreignTable: "security_reports", onDelete: "no action" },
      { columns: ["finding_id"], foreignTable: "vulnerability_findings", onDelete: "no action" },
    ]);
  });

  it("declares the ERD v2.2 indexes for all three tables", () => {
    expect(indexNamesOf(securityScores)).toEqual(
      [
        "security_scores_employer_id_idx",
        "security_scores_assessment_id_idx",
        "security_scores_methodology_version_idx",
        "security_scores_calculated_at_idx",
        "security_scores_employer_calculated_desc_idx",
        "security_scores_assessment_calculated_desc_idx",
      ].sort(),
    );
    expect(indexNamesOf(securityReports)).toEqual(
      [
        "security_reports_report_path_unique",
        "security_reports_assessment_id_idx",
        "security_reports_employer_id_idx",
        "security_reports_status_idx",
        "security_reports_prepared_by_user_id_idx",
        "security_reports_released_at_idx",
        "security_reports_employer_status_released_desc_idx",
        "security_reports_prepared_by_status_idx",
      ].sort(),
    );
    expect(indexNamesOf(securityReportFindings)).toEqual(
      [
        "security_report_findings_report_sort_order_idx",
        "security_report_findings_finding_id_idx",
      ].sort(),
    );
  });

  it("adds no visibility, release-flag, client-content or finding-snapshot columns (D-1, D6-2, D6-4, D6-7)", () => {
    const forbidden =
      /visib|published|released_flag|is_current|client_content|snapshot|title_snapshot|severity_snapshot|status_snapshot/;
    for (const table of [
      securityScores,
      securityReports,
      securityReportFindings,
      vulnerabilityFindings,
    ]) {
      expect(columnNames(table).filter((name) => forbidden.test(name))).toEqual([]);
    }
    // Membership never copies finding content.
    const findingContent = [
      "title",
      "severity",
      "description",
      "evidence_summary",
      "recommendation",
      "status",
      "resolved_at",
    ];
    expect(
      columnNames(securityReportFindings).filter((name) => findingContent.includes(name)),
    ).toEqual([]);
    // The assessment's pre-existing scope_snapshot is unrelated to reports and stays as it was.
    expect(columnNames(securityAssessments)).toContain("scope_snapshot");
  });
});
