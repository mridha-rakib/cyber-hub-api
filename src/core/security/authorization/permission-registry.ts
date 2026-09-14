import type { Role } from "./role.types";
import type { ScopeType } from "./scope.types";

/**
 * The exact 60 permission keys defined in RBAC & Permission Matrix v1.0 §6
 * ("Detailed Permission Registry and Grants"), transcribed verbatim.
 *
 * IMPORTANT — statistic correction vs Wave 0D-1: the Wave 0D-1 audit report
 * asserted "Total permission count: 47", but that number was a counting
 * error in that report's own summary line; the report's own §6 transcription
 * already listed all 60 rows. This has been re-verified directly against
 * the source document (RBAC_Permission_Matrix_v1.0.docx §6) by extracting
 * every `domain.action[.qualifier]`-shaped key from that section and
 * de-duplicating: the document defines exactly 60 permission keys, not 47.
 * This file uses the doc-verified count of 60. See the Wave 0D-2 report for
 * the full correction note.
 *
 * Do NOT rename, merge, alias, or invent keys. Do NOT add a wildcard ("*")
 * or an "ADMIN_ALL"-style universal key. ROLE_ADMIN's breadth comes only
 * from the explicit grants below, never from a `role === "ROLE_ADMIN"`
 * shortcut in enforcement code.
 */
export const PERMISSION_KEYS = [
  "public.content.read",
  "auth.learner.register",
  "auth.business.register",
  "account.profile.read_update_own",
  "account.delete.request_own",
  "account.role.assign_privileged",
  "resource.read",
  "resource.bookmark.manage_own",
  "resource.progress.manage_own",
  "resource.manage",
  "course.read",
  "course.manage_approve",
  "career.read",
  "career.submit_own",
  "career.manage_moderate",
  "career_tools.read",
  "cv_review.use_own",
  "portfolio.manage_own",
  "portfolio.publish_control_own",
  "portfolio.public.read",
  "internship.program.read",
  "internship.program.manage",
  "internship.application.create_own",
  "internship.application.read_own",
  "internship.application.review",
  "internship.task.read_assigned",
  "internship.task.manage_assign",
  "submission.create_update_own",
  "submission.review_assigned",
  "completion.review_assigned",
  "certificate.verify_public",
  "certificate.read_own",
  "certificate.issue_manage",
  "certificate.revoke",
  "employer.opportunity.submit_own",
  "employer.talent.discover",
  "employer.portal.moderate",
  "employer.communication.participate",
  "consulting.request.create_own",
  "consulting.scope.confirm_own",
  "consulting.request.read_own",
  "consulting.request.review_assigned",
  "consulting.internal_note.manage",
  "assessment.read_client",
  "assessment.manage_assigned",
  "finding.read_client",
  "finding.manage_assigned",
  "security_score.read_client",
  "security_score.calculate_assigned",
  "report.read_client",
  "report.prepare_review_assigned",
  "report.release_client",
  "monitoring.read_choose_own",
  "monitoring.perform_assigned",
  "monitoring.admin_manage",
  "donation.create",
  "donation.reporting.read_manage",
  "analytics.read",
  "audit.read",
  "audit.event.write_system",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const isPermissionKey = (value: string): value is PermissionKey =>
  (PERMISSION_KEYS as readonly string[]).includes(value);

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly domain: string;
  readonly description: string;
  /** Authenticated DB roles explicitly granted this permission key in RBAC v1.0 §6. */
  readonly allowedRoles: readonly Role[];
  /**
   * Scope categories RBAC v1.0 attaches to this permission key. This is
   * role-level contract metadata only — no resource-scope evaluation
   * (OWN/ORG/ASG/PUB/COND/AUTH_SCOPE resolution) happens in Wave 0D-2. A
   * non-empty scope list means the corresponding evaluator (built in Wave
   * 0D-3/0D-4) is a prerequisite before a real route using this key may be
   * role-only allowed; see permission.guard.ts's fail-closed gate.
   */
  readonly scope: readonly ScopeType[];
  /** True if RBAC v1.0 tags this key COND anywhere (feature/consent/workflow-state gated). */
  readonly conditional: boolean;
  /**
   * True only for `audit.event.write_system`, which RBAC v1.0 grants
   * "Indirect"ly as a system-triggered side effect of other protected
   * actions, not as a permission a human role can be checked against
   * directly via PermissionGuard.
   */
  readonly systemOnly: boolean;
}

function define(
  key: PermissionKey,
  domain: string,
  description: string,
  allowedRoles: readonly Role[],
  scope: readonly ScopeType[],
  conditional = false,
  systemOnly = false,
): PermissionDefinition {
  return { key, domain, description, allowedRoles, scope, conditional, systemOnly };
}

const DEFINITIONS: readonly PermissionDefinition[] = [
  define(
    "public.content.read",
    "public",
    "Public/legal/services content",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define("auth.learner.register", "auth", "Create learner account", ["ROLE_ADMIN"], []),
  define(
    "auth.business.register",
    "auth",
    "Create business/employer account",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    [],
  ),
  define(
    "account.profile.read_update_own",
    "account",
    "Read/update own human profile",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["OWN", "ORG"],
  ),
  define(
    "account.delete.request_own",
    "account",
    "Request account deletion",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["OWN", "COND"],
    true,
  ),
  define(
    "account.role.assign_privileged",
    "account",
    "Assign/change privileged human role",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "resource.read",
    "resource",
    "Browse/search/read resources",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "resource.bookmark.manage_own",
    "resource",
    "Manage bookmarks/favourites",
    ["ROLE_LEARNER"],
    ["OWN"],
  ),
  define(
    "resource.progress.manage_own",
    "resource",
    "Track learning progress",
    ["ROLE_LEARNER"],
    ["OWN", "COND"],
    true,
  ),
  define(
    "resource.manage",
    "resource",
    "Create/update/delete/publish resources",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "course.read",
    "course",
    "View course deals and approved external links",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define("course.manage_approve", "course", "Manage/approve course deals", ["ROLE_ADMIN"], []),
  define(
    "career.read",
    "career",
    "Browse/filter/open career listings",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "career.submit_own",
    "career",
    "Submit business career listing",
    ["ROLE_BUSINESS"],
    ["OWN"],
  ),
  define("career.manage_moderate", "career", "Manage/moderate career listings", ["ROLE_ADMIN"], []),
  define(
    "career_tools.read",
    "career_tools",
    "Access CV/interview guidance/bank",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "cv_review.use_own",
    "cv_review",
    "Use CV review workflow",
    ["ROLE_LEARNER", "ROLE_ADMIN"],
    ["OWN", "COND"],
    true,
  ),
  define(
    "portfolio.manage_own",
    "portfolio",
    "Create/update own portfolio evidence",
    ["ROLE_LEARNER"],
    ["OWN"],
  ),
  define(
    "portfolio.publish_control_own",
    "portfolio",
    "Publish/unpublish selected portfolio info",
    ["ROLE_LEARNER"],
    ["OWN"],
  ),
  define(
    "portfolio.public.read",
    "portfolio",
    "Read consented public portfolio/profile",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "internship.program.read",
    "internship",
    "Browse published internship/programme catalogue",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "internship.program.manage",
    "internship",
    "Manage internship programmes",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "internship.application.create_own",
    "internship",
    "Submit application",
    ["ROLE_LEARNER"],
    ["OWN"],
  ),
  define(
    "internship.application.read_own",
    "internship",
    "Read own application/progress",
    ["ROLE_LEARNER", "ROLE_ADMIN"],
    ["OWN"],
  ),
  define(
    "internship.application.review",
    "internship",
    "Review/decide applications",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "internship.task.read_assigned",
    "internship",
    "Read assigned tasks",
    ["ROLE_LEARNER", "ROLE_MENTOR", "ROLE_ADMIN"],
    ["OWN", "ASG"],
  ),
  define(
    "internship.task.manage_assign",
    "internship",
    "Create/manage/assign internship tasks",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "submission.create_update_own",
    "submission",
    "Submit/update own task evidence",
    ["ROLE_LEARNER", "ROLE_ADMIN"],
    ["OWN"],
  ),
  define(
    "submission.review_assigned",
    "submission",
    "Review assigned learner evidence",
    ["ROLE_MENTOR", "ROLE_ADMIN"],
    ["ASG"],
  ),
  define(
    "completion.review_assigned",
    "completion",
    "Review completion evidence",
    ["ROLE_MENTOR", "ROLE_ADMIN"],
    ["ASG"],
  ),
  define(
    "certificate.verify_public",
    "certificate",
    "Verify certificate by public ID/QR",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "certificate.read_own",
    "certificate",
    "View/download own certificate/PDF/status",
    ["ROLE_LEARNER", "ROLE_ADMIN"],
    ["OWN"],
  ),
  define(
    "certificate.issue_manage",
    "certificate",
    "Manage eligibility/issue certificate",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "certificate.revoke",
    "certificate",
    "Revoke/update certificate status",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "employer.opportunity.submit_own",
    "employer",
    "Submit internship opportunity/student project",
    ["ROLE_BUSINESS"],
    ["OWN"],
  ),
  define(
    "employer.talent.discover",
    "employer",
    "Discover emerging talent",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["PUB"],
  ),
  define(
    "employer.portal.moderate",
    "employer",
    "Moderate employer submissions/activity",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "employer.communication.participate",
    "employer",
    "Use moderated communication workflow",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG", "COND"],
    true,
  ),
  define(
    "consulting.request.create_own",
    "consulting",
    "Create consulting/security service request",
    ["ROLE_BUSINESS"],
    ["ORG"],
  ),
  define(
    "consulting.scope.confirm_own",
    "consulting",
    "Confirm explicit testing scope/authorisation",
    ["ROLE_BUSINESS", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ORG", "ASG"],
  ),
  define(
    "consulting.request.read_own",
    "consulting",
    "Read own request/status",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG"],
  ),
  define(
    "consulting.request.review_assigned",
    "consulting",
    "Review/accept assigned request",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG"],
  ),
  define(
    "consulting.internal_note.manage",
    "consulting",
    "Manage internal assignment notes",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG"],
  ),
  define(
    "assessment.read_client",
    "assessment",
    "Read own assessment history/status",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG"],
  ),
  define(
    "assessment.manage_assigned",
    "assessment",
    "Perform/record assigned authorised assessment",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG", "AUTH_SCOPE"],
  ),
  define(
    "finding.read_client",
    "finding",
    "Read client-visible findings/risk counts",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG"],
  ),
  define(
    "finding.manage_assigned",
    "finding",
    "Create/update/prioritise assigned findings",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG", "AUTH_SCOPE"],
  ),
  define(
    "security_score.read_client",
    "security_score",
    "Read own overall/category scores",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG"],
  ),
  define(
    "security_score.calculate_assigned",
    "security_score",
    "Calculate/update score from assigned assessment",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG", "AUTH_SCOPE"],
  ),
  define(
    "report.read_client",
    "report",
    "Read released client security report",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG"],
  ),
  define(
    "report.prepare_review_assigned",
    "report",
    "Prepare/review report draft",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG"],
  ),
  define(
    "report.release_client",
    "report",
    "Release approved report to client",
    ["ROLE_ADMIN"],
    [],
  ),
  define(
    "monitoring.read_choose_own",
    "monitoring",
    "View status/dates and choose monitoring",
    ["ROLE_BUSINESS", "ROLE_ADMIN"],
    ["ORG", "COND"],
    true,
  ),
  define(
    "monitoring.perform_assigned",
    "monitoring",
    "Perform recurring monitoring/review",
    ["ROLE_CONSULTANT", "ROLE_ADMIN"],
    ["ASG", "COND"],
    true,
  ),
  define(
    "monitoring.admin_manage",
    "monitoring",
    "Manage subscriptions/status/review date",
    ["ROLE_ADMIN"],
    ["COND"],
    true,
  ),
  define(
    "donation.create",
    "donation",
    "Make donation via secure provider",
    ["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"],
    [],
  ),
  define(
    "donation.reporting.read_manage",
    "donation",
    "View/administer donation reporting",
    ["ROLE_ADMIN"],
    [],
  ),
  define("analytics.read", "analytics", "Access platform analytics", ["ROLE_ADMIN"], []),
  define("audit.read", "audit", "Read security-relevant audit logs", ["ROLE_ADMIN"], []),
  define(
    "audit.event.write_system",
    "audit",
    "Create security-relevant audit event",
    [],
    [],
    false,
    true,
  ),
];

export const PERMISSION_REGISTRY: Readonly<Record<PermissionKey, PermissionDefinition>> =
  Object.freeze(
    Object.fromEntries(DEFINITIONS.map((definition) => [definition.key, definition])) as Record<
      PermissionKey,
      PermissionDefinition
    >,
  );
