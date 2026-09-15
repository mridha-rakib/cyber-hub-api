import type { ApiId, ApiOperationAuthorization } from "./api-authorization-map";
import type { PermissionKey } from "./permission-registry";

/**
 * Wave 0D-5. Authorization decision and disclosure decision are related but
 * separate: a caller can be correctly denied (role/scope/AUTH_SCOPE fails)
 * while the EXTERNAL response still needs to decide whether admitting the
 * resource exists at all would leak private cross-user, cross-tenant,
 * assignment-only, or pre-release information.
 *
 * - DISCLOSE_FORBIDDEN: an authenticated authorization failure may safely
 *   stay 403 -- the operation's own existence/denial signal reveals nothing
 *   sensitive (e.g. Admin's own unconditional oversight console, or content
 *   that becomes public once approved).
 * - CONCEAL_EXISTENCE: an authenticated unauthorized caller must receive a
 *   generic 404 instead -- the resource is private/tenant-scoped/
 *   assignment-only/pre-release, and a 403 would itself confirm a specific
 *   record id refers to a real, private object.
 * - NOT_APPLICABLE: the operation does not operate on an identifiable
 *   protected resource in a way where existence concealment is meaningful
 *   (list/collection endpoints, creates against a public parent, PUBLIC/
 *   AUTHENTICATED_ONLY routes, CALLER_DOMAIN_PERMISSION operations whose
 *   real decision belongs to the parent domain operation).
 */
export type AuthorizationDisclosurePolicy =
  | "DISCLOSE_FORBIDDEN"
  | "CONCEAL_EXISTENCE"
  | "NOT_APPLICABLE";

/**
 * Permission-key-level classification, derived from RBAC & Permission
 * Matrix v1.0, API Contract v1.1 (see API-RPT-002/010/011/012's existing
 * `nonDisclosure` citations of "Sec.13, AC-013" -- pre-release report
 * existence-hiding), and UI Screen Inventory v1.1 6.4 ("forbidden/
 * non-disclosure" state documented on Portfolio Overview, Programme
 * Progress Detail, Submission Detail, Certificate Detail; "404/non-owner"
 * documented explicitly on Internship Application Detail).
 *
 * Applies only when `resourceContextRequired` is true for the concrete
 * operation -- see `resolveDisclosurePolicy`. Every one of the 39
 * permission keys that appear on at least one resourceContextRequired
 * operation is classified below (no permission key is left to the
 * conservative default; the default exists only for keys not yet audited
 * if the registry grows in a future wave).
 */
const CONCEAL_EXISTENCE_KEYS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  // Security domain (Phase 12): consulting requests, assessments,
  // AUTH_SCOPE authorizations, findings, scores, reports -- all sensitive
  // "business/client security record" categories named explicitly.
  // Wave 0D-8 re-verification: DIRECTLY confirmed by RBAC & Permission
  // Matrix v1.0 RBAC-AC-003 ("Business cannot read or mutate another
  // business/employer's consulting, assessment, score, finding or report
  // data" -- Tenant/object authorization tests) and RBAC-AC-005
  // ("Consultant can access only assigned/authorised client security
  // work" -- Assignment/scope security tests). No longer analogy-only.
  "assessment.manage_assigned",
  "assessment.read_client",
  "consulting.internal_note.manage",
  "consulting.request.read_own",
  "consulting.request.review_assigned",
  "consulting.scope.confirm_own",
  "finding.manage_assigned",
  "security_score.calculate_assigned",
  "report.prepare_review_assigned",
  "report.read_client",
  "report.release_client",
  // Business-private paid security monitoring engagement -- same category
  // as consulting requests (a specific tenant's security service record).
  // Wave 0D-8 re-verification: RBAC v1.0 §6 confirms these are COND-gated
  // ("C/V ORG COND" / "M COND" -- see role-policy.ts's
  // MONITORING_SUBSCRIPTION_ACTIVE/MONITORING_ADMIN_FEATURE_ENABLED
  // conditions), but no RBAC-AC item or other source row explicitly
  // states existence-concealment for monitoring subscriptions the way
  // RBAC-AC-003 does for consulting/assessment/score/finding/report.
  // REMAINS A JUDGMENT CALL: kept as CONCEAL_EXISTENCE by direct analogy
  // to the explicitly-cited consulting/assessment category (monitoring is
  // the same kind of tenant-private paid security engagement record), not
  // reclassified absent a contradicting source. See Outstanding Product/
  // Policy Clarifications in the Wave 0D-8 report.
  "monitoring.admin_manage",
  "monitoring.read_choose_own",
  // Cross-tenant business-private data (tenant isolation, Phase 9):
  // pre-publication listing lifecycle belongs to one employer only.
  "career.submit_own",
  "employer.opportunity.submit_own",
  // Private learner/user data (OWN concealment, Phase 10), matching the UI
  // Screen Inventory's documented "forbidden/non-disclosure" / "404/
  // non-owner" states for these exact resources.
  // Wave 0D-8 re-verification: DIRECTLY confirmed by RBAC-AC-002
  // ("Learner cannot read or mutate another learner's private profile,
  // portfolio, application, task evidence or certificate-private data" --
  // Object-level authorization tests). No longer analogy-only for
  // portfolio/application/submission("task evidence")/certificate.
  "certificate.read_own",
  "internship.application.read_own",
  "internship.task.read_assigned",
  "portfolio.manage_own",
  "portfolio.publish_control_own",
  "resource.progress.manage_own",
  "submission.create_update_own",
  // Assignment-only sensitive resources (ASG concealment, Phase 11):
  // reviewing another mentor/consultant's assignee's private work must not
  // confirm the assignment/submission/enrollment exists. Wave 0D-8: RBAC-
  // AC-004 ("Mentor can review only assigned submissions/completion
  // evidence") directly supports completion.review_assigned/
  // submission.review_assigned.
  "completion.review_assigned",
  "submission.review_assigned",
  // Admin-issued credential tied to one specific learner's private
  // enrollment record (distinct from the certificate's own later public
  // verification route, which is governed separately by PUB). Same
  // RBAC-AC-002 "task evidence"/enrollment-private-data category.
  "certificate.issue_manage",
  // Other users' private audit trail / financial records -- sensitive by
  // nature even though only Admin may ever legitimately reach them. Wave
  // 0D-8 re-verification: RBAC v1.0 §6 describes `audit.read` as "Admin
  // permissions; sensitive metadata minimized" and `donation.reporting.
  // read_manage` as "No public donor management grant" -- both consistent
  // with, but not a literal existence-concealment statement equivalent to
  // RBAC-AC-002/003. REMAINS A JUDGMENT CALL, kept conservative (conceal)
  // rather than relaxed, absent a contradicting source. See Outstanding
  // Product/Policy Clarifications.
  "audit.read",
  "donation.reporting.read_manage",
]);

const DISCLOSE_FORBIDDEN_KEYS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  // Admin's own unconditional, documented oversight/moderation/content-
  // management domains (RBAC v1.0: no ORG/OWN/ASG restriction). Denial in
  // these operations reflects Admin's own console, not another party's
  // hidden private resource -- and the underlying content (courses,
  // internship program definitions, platform resources, moderation
  // queues, the user/employer directory itself) becomes visible to Admin
  // unconditionally by design, or is public once approved.
  "account.role.assign_privileged",
  "career.manage_moderate",
  "course.manage_approve",
  "employer.portal.moderate",
  "internship.application.review",
  "internship.program.manage",
  // Once issued, certificates are explicitly documented as publicly
  // verifiable, including after revocation ("Revoked status must remain
  // visible") -- there is no existence-hiding interest to protect here.
  "certificate.revoke",
  // Admin's own platform content management (learning resources).
  "resource.manage",
  // A bookmark is keyed by (caller's own user, a PUBLIC resource) -- there
  // is no "other user's bookmark" to conceal; "not found" here just means
  // the caller has no bookmark for that already-public resource.
  "resource.bookmark.manage_own",
]);

const NOT_APPLICABLE_KEYS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  "career.read",
  "course.read",
  "portfolio.public.read",
  "public.content.read",
  "resource.read",
  // Targets a published/browsable internship listing, not a private
  // per-caller record -- the application being created does not exist yet.
  "internship.application.create_own",
]);

/**
 * Per-operation overrides for the rare case where a single permission key
 * spans resources of genuinely different sensitivity. Only
 * `internship.task.manage_assign` does this: API-ENR-004/005 operate on
 * `{enrollmentId}` (one specific learner's private enrollment -- same
 * sensitivity class as `internship.application.read_own`), while
 * API-TSK-001..004 operate on `{internshipId}`/`{taskId}` (admin-authored
 * task/programme template content, not a specific learner's data -- same
 * class as `internship.program.manage`).
 *
 * Wave 0D-8 re-verification: RBAC & Permission Matrix v1.0 RBAC-AC-002
 * ("Learner cannot read or mutate another learner's private ... task
 * evidence ... data" -- Object-level authorization tests) DIRECTLY
 * supports the ENR-004/005 (learner-enrollment) half of this split as
 * CONCEAL_EXISTENCE; RBAC v1.0 §6's own `internship.task.manage_assign`
 * row ("C/V/U/M | Admin" -- FR-ADM-007, Admin-only, no per-role scope
 * suffix) supports the TSK-001..004 (admin-authored task-template) half
 * remaining a plain Admin-console DISCLOSE_FORBIDDEN, consistent with
 * every other Admin-only content-management key in this file. Confirmed
 * unchanged; no correction required.
 */
const OPERATION_DISCLOSURE_OVERRIDES: ReadonlyMap<ApiId, AuthorizationDisclosurePolicy> = new Map([
  ["API-ENR-004", "CONCEAL_EXISTENCE"],
  ["API-ENR-005", "CONCEAL_EXISTENCE"],
  ["API-TSK-001", "DISCLOSE_FORBIDDEN"],
  ["API-TSK-002", "DISCLOSE_FORBIDDEN"],
  ["API-TSK-003", "DISCLOSE_FORBIDDEN"],
  ["API-TSK-004", "DISCLOSE_FORBIDDEN"],
]);

/**
 * Resolves the disclosure policy for a concrete request. This is the
 * single function PermissionGuard calls -- never a scattered
 * `if (...) throw NotFoundException()` per controller.
 *
 * `resourceContextRequired: false` always yields NOT_APPLICABLE regardless
 * of permission key: with no identifiable resource locator, there is
 * nothing whose existence could be concealed (list/collection endpoints,
 * self-only /me actions with no id, creates against a not-yet-existing
 * record).
 */
export function resolveDisclosurePolicy(
  permissionKey: PermissionKey,
  apiId: ApiId | null | undefined,
  resourceContextRequired: boolean,
): AuthorizationDisclosurePolicy {
  if (!resourceContextRequired) return "NOT_APPLICABLE";

  if (apiId) {
    const override = OPERATION_DISCLOSURE_OVERRIDES.get(apiId);
    if (override) return override;
  }

  if (CONCEAL_EXISTENCE_KEYS.has(permissionKey)) return "CONCEAL_EXISTENCE";
  if (DISCLOSE_FORBIDDEN_KEYS.has(permissionKey)) return "DISCLOSE_FORBIDDEN";
  if (NOT_APPLICABLE_KEYS.has(permissionKey)) return "NOT_APPLICABLE";

  // Conservative default for any permission key not yet explicitly
  // classified above: never invent concealment merely because "404 is
  // more secure" -- an unclassified key keeps today's ordinary 403.
  return "DISCLOSE_FORBIDDEN";
}

/**
 * Convenience wrapper for auditing a full `ApiOperationAuthorization` row
 * (used by the structural 209-operation coverage test) rather than the
 * live per-request guard path.
 */
export function resolveDisclosurePolicyForOperation(
  op: ApiOperationAuthorization,
): AuthorizationDisclosurePolicy {
  if (op.classification !== "PERMISSION_PROTECTED") return "NOT_APPLICABLE";
  if (op.authorizationMode === "CALLER_DOMAIN_PERMISSION") return "NOT_APPLICABLE";
  if (!op.permissionKey) return "NOT_APPLICABLE";
  return resolveDisclosurePolicy(op.permissionKey, op.apiId, op.resourceContextRequired);
}
