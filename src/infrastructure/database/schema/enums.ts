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
