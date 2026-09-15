import { getTableColumns, getTableName } from "drizzle-orm";
import { consultingRequests } from "./consulting-requests";
import { assessmentStatus, consultingStatus, securityServiceType } from "./enums";
import { securityAssessments } from "./security-assessments";
import { securityScopeAuthorizations } from "./security-scope-authorizations";

describe("Wave 0D-4B AUTH_SCOPE persistence prerequisite schema", () => {
  it("exposes exactly the three new ERD tables under their exact ERD names", () => {
    expect(getTableName(consultingRequests)).toBe("consulting_requests");
    expect(getTableName(securityScopeAuthorizations)).toBe("security_scope_authorizations");
    expect(getTableName(securityAssessments)).toBe("security_assessments");
  });

  it("defines the exact ERD enum values with no invented aliases", () => {
    expect(consultingStatus.enumValues).toEqual([
      "SUBMITTED",
      "UNDER_REVIEW",
      "ACCEPTED",
      "DECLINED",
      "IN_PROGRESS",
      "COMPLETED",
    ]);
    expect(assessmentStatus.enumValues).toEqual([
      "PLANNED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(securityServiceType.enumValues).toEqual([
      "WEBSITE_ASSESSMENT",
      "NETWORK_ASSESSMENT",
      "VULNERABILITY_ASSESSMENT",
      "PHISHING_AWARENESS",
      "CLOUD_REVIEW",
      "CYBER_RISK_ASSESSMENT",
      "SECURITY_DOCUMENTATION",
    ]);
  });

  describe("consulting_requests", () => {
    it("requires employer_id and submitted_by_user_id, leaves assigned_consultant_id nullable", () => {
      const columns = getTableColumns(consultingRequests);
      expect(columns.employerId.notNull).toBe(true);
      expect(columns.submittedByUserId.notNull).toBe(true);
      expect(columns.assignedConsultantId.notNull).toBe(false);
    });

    it("defaults state_version to 1 (workflow version column present, no transition logic implied)", () => {
      expect(getTableColumns(consultingRequests).stateVersion.default).toBe(1);
    });

    it("makes business_impact the only documented optional CONFIDENTIAL text field", () => {
      const columns = getTableColumns(consultingRequests);
      expect(columns.businessImpact.notNull).toBe(false);
      expect(columns.companyDetails.notNull).toBe(true);
      expect(columns.securityConcern.notNull).toBe(true);
      expect(columns.contactInformation.notNull).toBe(true);
    });
  });

  describe("security_scope_authorizations", () => {
    it("requires consulting_request_id, employer_id, and confirmed_by_user_id", () => {
      const columns = getTableColumns(securityScopeAuthorizations);
      expect(columns.consultingRequestId.notNull).toBe(true);
      expect(columns.employerId.notNull).toBe(true);
      expect(columns.confirmedByUserId.notNull).toBe(true);
    });

    it("requires authorized_targets and allowed_activities, defaults restrictions to an empty array", () => {
      const columns = getTableColumns(securityScopeAuthorizations);
      expect(columns.authorizedTargets.notNull).toBe(true);
      expect(columns.allowedActivities.notNull).toBe(true);
      expect(columns.restrictions.notNull).toBe(true);
      expect(columns.restrictions.default).toEqual([]);
    });

    it("requires valid_from but leaves valid_until optional (open-ended authorization is documented)", () => {
      const columns = getTableColumns(securityScopeAuthorizations);
      expect(columns.validFrom.notNull).toBe(true);
      expect(columns.validUntil.notNull).toBe(false);
    });

    it("defaults is_current to true and leaves superseded_at/revoked_at nullable", () => {
      const columns = getTableColumns(securityScopeAuthorizations);
      expect(columns.isCurrent.default).toBe(true);
      expect(columns.supersededAt.notNull).toBe(false);
      expect(columns.revokedAt.notNull).toBe(false);
    });
  });

  describe("security_assessments", () => {
    it("requires employer_id, consulting_request_id, scope_authorization_id, and assigned_consultant_id — the links AuthScopeEvaluator depends on", () => {
      const columns = getTableColumns(securityAssessments);
      expect(columns.employerId.notNull).toBe(true);
      expect(columns.consultingRequestId.notNull).toBe(true);
      expect(columns.scopeAuthorizationId.notNull).toBe(true);
      expect(columns.assignedConsultantId.notNull).toBe(true);
    });

    it("defaults state_version to 1 and leaves started/completed/cancelled timestamps nullable", () => {
      const columns = getTableColumns(securityAssessments);
      expect(columns.stateVersion.default).toBe(1);
      expect(columns.startedAt.notNull).toBe(false);
      expect(columns.completedAt.notNull).toBe(false);
      expect(columns.cancelledAt.notNull).toBe(false);
    });
  });
});
