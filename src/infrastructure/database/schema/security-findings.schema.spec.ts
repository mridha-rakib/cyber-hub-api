import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { assessmentStatus, findingSeverity, findingStatus } from "./enums";
import { securityAssessments } from "./security-assessments";
import { vulnerabilityFindings } from "./vulnerability-findings";

describe("Wave 5A security assessment + findings persistence schema", () => {
  it("uses the exact ERD §6 enum names and values", () => {
    expect(assessmentStatus.enumName).toBe("assessment_status");
    expect(assessmentStatus.enumValues).toEqual([
      "PLANNED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(findingSeverity.enumName).toBe("finding_severity");
    expect(findingSeverity.enumValues).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect(findingStatus.enumName).toBe("finding_status");
    expect(findingStatus.enumValues).toEqual(["OPEN", "REMEDIATION_IN_PROGRESS", "RESOLVED"]);
  });

  it("defines exactly the ERD §7.31 vulnerability_findings columns", () => {
    expect(getTableName(vulnerabilityFindings)).toBe("vulnerability_findings");
    const columns = getTableColumns(vulnerabilityFindings);
    expect(Object.values(columns).map((column) => column.name)).toEqual([
      "id",
      "assessment_id",
      "employer_id",
      "title",
      "severity",
      "description",
      "evidence_summary",
      "recommendation",
      "status",
      "state_version",
      "resolved_at",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ]);
  });

  it("requires tenant, assessment, author and lifecycle fields; optional fields stay nullable", () => {
    const columns = getTableColumns(vulnerabilityFindings);
    for (const required of [
      columns.assessmentId,
      columns.employerId,
      columns.title,
      columns.severity,
      columns.recommendation,
      columns.status,
      columns.stateVersion,
      columns.createdByUserId,
      columns.createdAt,
      columns.updatedAt,
    ]) {
      expect(required.notNull).toBe(true);
    }
    for (const optional of [columns.description, columns.evidenceSummary, columns.resolvedAt]) {
      expect(optional.notNull).toBe(false);
    }
    expect(columns.stateVersion.default).toBe(1);
    // Status is server-chosen per transition (WF-FND-01 creates OPEN); no
    // database default may silently pick a lifecycle state.
    expect(columns.status.hasDefault).toBe(false);
  });

  it("references the parent assessment, owning employer and author by non-cascading foreign key", () => {
    const foreignKeys = getTableConfig(vulnerabilityFindings).foreignKeys.map((fk) => {
      const reference = fk.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: getTableName(reference.foreignTable),
        onDelete: fk.onDelete,
      };
    });
    // ERD §5: governed records default to NO ACTION — no business-history cascade.
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        { columns: ["assessment_id"], foreignTable: "security_assessments", onDelete: "no action" },
        { columns: ["employer_id"], foreignTable: "employers", onDelete: "no action" },
        { columns: ["created_by_user_id"], foreignTable: "users", onDelete: "no action" },
      ]),
    );
    expect(foreignKeys).toHaveLength(3);
  });

  it("defines the ERD §7.31 composite indexes", () => {
    const indexes = getTableConfig(vulnerabilityFindings).indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map((column) => ("name" in column ? column.name : undefined)),
    }));
    expect(indexes).toEqual(
      expect.arrayContaining([
        {
          name: "vulnerability_findings_assessment_severity_status_idx",
          columns: ["assessment_id", "severity", "status"],
        },
        {
          name: "vulnerability_findings_employer_status_severity_idx",
          columns: ["employer_id", "status", "severity"],
        },
        {
          name: "vulnerability_findings_created_by_created_desc_idx",
          columns: ["created_by_user_id", "created_at"],
        },
      ]),
    );
  });

  it("keeps the assessment context needed for ASG + AUTH_SCOPE checks on the parent row", () => {
    const assessmentColumns = getTableColumns(securityAssessments);
    expect(assessmentColumns.assignedConsultantId.notNull).toBe(true);
    expect(assessmentColumns.scopeAuthorizationId.notNull).toBe(true);
    expect(assessmentColumns.employerId.notNull).toBe(true);
    const findingColumns = Object.keys(getTableColumns(vulnerabilityFindings));
    // Findings never carry their own copy of scope or assignment: both are
    // always resolved through the parent assessment.
    expect(findingColumns).not.toContain("scopeAuthorizationId");
    expect(findingColumns).not.toContain("assignedConsultantId");
  });
});
