import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "ROLE_LEARNER",
  "ROLE_BUSINESS",
  "ROLE_MENTOR",
  "ROLE_CONSULTANT",
  "ROLE_ADMIN",
]);

export const employerStatus = pgEnum("employer_status", ["ACTIVE", "SUSPENDED", "CLOSED"]);

export const authTokenPurpose = pgEnum("auth_token_purpose", [
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
]);

/**
 * Wave 0D-4B: exact enum values transcribed from Database ERD & Data
 * Dictionary v2.0 — the single "Status / Enum Values" reference table
 * (source row: "security_service_type | WEBSITE_ASSESSMENT,
 * NETWORK_ASSESSMENT, VULNERABILITY_ASSESSMENT, PHISHING_AWARENESS,
 * CLOUD_REVIEW, CYBER_RISK_ASSESSMENT, SECURITY_DOCUMENTATION | v2 service
 * catalogue").
 */
export const securityServiceType = pgEnum("security_service_type", [
  "WEBSITE_ASSESSMENT",
  "NETWORK_ASSESSMENT",
  "VULNERABILITY_ASSESSMENT",
  "PHISHING_AWARENESS",
  "CLOUD_REVIEW",
  "CYBER_RISK_ASSESSMENT",
  "SECURITY_DOCUMENTATION",
]);

/**
 * ERD §7.27 consulting_requests.status: "SUBMITTED | UNDER_REVIEW |
 * ACCEPTED | DECLINED | IN_PROGRESS | COMPLETED" (source: WF-REQ). Values
 * only — the state machine/transition commands themselves are Wave 0D-6
 * scope, not implemented here.
 */
export const consultingStatus = pgEnum("consulting_status", [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "DECLINED",
  "IN_PROGRESS",
  "COMPLETED",
]);

/**
 * ERD §7.30 security_assessments.status: "PLANNED | IN_PROGRESS |
 * COMPLETED | CANCELLED" (source: WF-ASM). Values only — see note above.
 */
export const assessmentStatus = pgEnum("assessment_status", [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

/**
 * ERD §6 Enum Catalogue: "finding_severity | CRITICAL, HIGH, MEDIUM, LOW |
 * SRS v2" — used by §7.31 `vulnerability_findings.severity` (FR-CON-005).
 * Severity is deliberately a separate enum from `finding_status`: State &
 * Workflow Spec v1.0 §6.4 "Severity ... is separate from lifecycle status".
 */
export const findingSeverity = pgEnum("finding_severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

/**
 * ERD §6 Enum Catalogue: "finding_status | OPEN, REMEDIATION_IN_PROGRESS,
 * RESOLVED | WF-FND" — used by §7.31 `vulnerability_findings.status`.
 * Values only — the WF-FND-01..05 transitions live in the Wave 0D-6
 * workflow registry.
 */
export const findingStatus = pgEnum("finding_status", [
  "OPEN",
  "REMEDIATION_IN_PROGRESS",
  "RESOLVED",
]);

/**
 * ERD §6 Enum Catalogue: "report_status | DRAFT, IN_REVIEW,
 * READY_FOR_RELEASE, RELEASED, SUPERSEDED | WF-RPT" — used by §7.33
 * `security_reports.status`. Values only — the WF-RPT-01..07 transitions
 * live in the workflow registry; their commands are Wave 6B.
 */
export const reportStatus = pgEnum("report_status", [
  "DRAFT",
  "IN_REVIEW",
  "READY_FOR_RELEASE",
  "RELEASED",
  "SUPERSEDED",
]);

/**
 * ERD §7.19 internships.status: "DRAFT | PUBLISHED | CLOSED | ARCHIVED"
 * (source: WF-PRG, State & Workflow Spec v1.0 §3.1). Values only — the
 * WF-PRG-01..04 transition commands live in the Wave 0D-6 workflow
 * registry; this Wave (1) implements the real controller/service behind
 * them for the first time.
 */
export const internshipStatus = pgEnum("internship_status", [
  "DRAFT",
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
]);

/**
 * ERD §7.20 internship_applications.status: "SUBMITTED | UNDER_REVIEW |
 * ACCEPTED | REJECTED" (source: WF-APP, State & Workflow Spec v1.0 §3.2).
 */
export const applicationStatus = pgEnum("application_status", [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "REJECTED",
]);

/**
 * ERD §7.21 internship_enrollments.completion_eligibility: "NOT_ELIGIBLE |
 * ELIGIBLE" (source: State & Workflow Spec v1.0 §3.5 — a derived gate,
 * explicitly NOT a Certificate status and NOT a state machine; there is no
 * named transition command for this value, it is computed).
 */
export const completionEligibility = pgEnum("completion_eligibility", ["NOT_ELIGIBLE", "ELIGIBLE"]);

/**
 * ERD §7.24 submissions.status: "SUBMITTED | UNDER_REVIEW | APPROVED |
 * REVISION_REQUIRED" (source: WF-SUB, State & Workflow Spec v1.0 §3.4).
 */
export const submissionStatus = pgEnum("submission_status", [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REVISION_REQUIRED",
]);

/**
 * ERD §7.26 certificates.status: "ISSUED | REVOKED" (source: WF-CERT,
 * State & Workflow Spec v1.0 §4). No `state_version` column is documented
 * for this table — the Wave 0D-6 `Certificate` workflow registry entry
 * exists, but the CAS mechanism for the revoke transition uses `status`
 * itself as the compare key (see `certificates.repository.ts`'s
 * `revoke()`), not a separate integer counter.
 */
export const certificateStatus = pgEnum("certificate_status", ["ISSUED", "REVOKED"]);

/**
 * ERD §6 Enum Catalogue: "career_listing_type | JOB, INTERNSHIP,
 * GRADUATE_ROLE, APPRENTICESHIP | SRS UK Career" — used by §7.9 `jobs`.
 */
export const careerListingType = pgEnum("career_listing_type", [
  "JOB",
  "INTERNSHIP",
  "GRADUATE_ROLE",
  "APPRENTICESHIP",
]);

/**
 * ERD §6 Enum Catalogue: "listing_status | SUBMITTED, UNDER_REVIEW,
 * PUBLISHED, REJECTED, CLOSED | WF-LST" — the shared Employer Opportunity /
 * Career Listing Moderation lifecycle (State & Workflow Spec v1.0 §5),
 * used by both §7.9 `jobs` and §7.10 `employer_opportunities`.
 */
export const listingStatus = pgEnum("listing_status", [
  "SUBMITTED",
  "UNDER_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "CLOSED",
]);

/**
 * ERD §6 Enum Catalogue: "employer_opportunity_type |
 * INTERNSHIP_OPPORTUNITY, STUDENT_PROJECT | Employer portal" — used by
 * §7.10 `employer_opportunities`.
 */
export const employerOpportunityType = pgEnum("employer_opportunity_type", [
  "INTERNSHIP_OPPORTUNITY",
  "STUDENT_PROJECT",
]);

/**
 * ERD v2.3 §6 Enum Catalogue: "content_status | DRAFT, PUBLISHED, ARCHIVED |
 * Resource publishing" — used by §7.5 `resources.status`. Values only — the
 * WF-RES-01..04 lifecycle (State & Workflow v1.3 §5A.1) is enforced by the
 * application service, not here.
 */
export const contentStatus = pgEnum("content_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);

/**
 * ERD v2.3 §6 Enum Catalogue: "course_approval_status | DRAFT, APPROVED,
 * REJECTED | Course moderation" — used by §7.8 `courses.approval_status`.
 * There is deliberately no WITHDRAWN value: withdrawal is APPROVED -> REJECTED
 * (WF-CRS-05, State & Workflow v1.3 §5A.2).
 */
export const courseApprovalStatus = pgEnum("course_approval_status", [
  "DRAFT",
  "APPROVED",
  "REJECTED",
]);
