import type {
  SecurityReport,
  SecurityReportFinding,
  VulnerabilityFinding,
} from "../../../infrastructure/database/schema";
import { findingView } from "../../security-work/services/security-work.service";

/**
 * API-RPT-002 internal operational projection (Consultant dual ASG / Admin
 * only): the full report detail (D6-9 "full internal detail remains
 * API-RPT-002") plus included finding membership ordered by sortOrder with the
 * existing internal finding projection. Never served to ROLE_BUSINESS.
 */
export function reportView(
  row: SecurityReport,
  memberships: { membership: SecurityReportFinding; finding: VulnerabilityFinding }[],
) {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    employerId: row.employerId,
    draftContent: row.draftContent,
    reportPath: row.reportPath,
    status: row.status,
    stateVersion: row.stateVersion,
    versionNo: row.versionNo,
    supersedesReportId: row.supersedesReportId,
    preparedByUserId: row.preparedByUserId,
    reviewedByUserId: row.reviewedByUserId,
    releasedByUserId: row.releasedByUserId,
    generatedAt: row.generatedAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    includedFindings: memberships.map(({ membership, finding }) => ({
      findingId: membership.findingId,
      sortOrder: membership.sortOrder,
      includedAt: membership.includedAt,
      finding: findingView(finding),
    })),
  };
}

/** SecurityReportOperationalSummaryView (API-RPT-013): never draftContent or paths. */
export function reportSummaryView(
  row: Pick<
    SecurityReport,
    | "id"
    | "assessmentId"
    | "status"
    | "versionNo"
    | "stateVersion"
    | "supersedesReportId"
    | "releasedAt"
    | "createdAt"
    | "updatedAt"
  >,
) {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    status: row.status,
    versionNo: row.versionNo,
    stateVersion: row.stateVersion,
    supersedesReportId: row.supersedesReportId,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
