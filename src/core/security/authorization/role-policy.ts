import type { PermissionKey } from "./permission-registry";
import type { Role } from "./role.types";
import type { ScopeType } from "./scope.types";

/**
 * Role-aware authorization policy — Wave 0D-3 Closure Pass.
 *
 * Replaces the role-blind flat `scope`/`conditional` fields on
 * PermissionDefinition as the source PermissionGuard/ScopeEvaluationService
 * actually evaluate against. Transcribed directly, role-by-role, from RBAC
 * & Permission Matrix v1.0 §6 ("Detailed Permission Registry and Grants") —
 * extracted from the source table's Visitor/Learner/Business/Mentor/
 * Consultant/Admin columns via table-row-aware XML parsing (not the earlier
 * flattened prose transcription), so each role's exact grant cell (e.g.
 * "V/U OWN" for Learner vs "V/U ORG" for Business vs "M" for Admin on
 * account.profile.read_update_own) is preserved per-role rather than
 * unioned into one set applied to every granted role.
 *
 * Each entry's per-role comment quotes the exact source cell text for
 * traceability. A role absent from a key's policy map here has NO scope
 * requirement recorded — PermissionGuard treats this as a hard DENY (see
 * "A role with no policy entry is denied", Wave 0D-3 Closure Pass Phase 3),
 * distinct from the permission-registry's allowedRoles (which only proves
 * the role has SOME grant, not what it's authorized to access without
 * further scope checks).
 *
 * IMPORTANT — what this file does NOT change: verb-level (V/C/U/R/D/A/I)
 * distinctions from the RBAC cells are not modeled (this framework doesn't
 * yet distinguish read vs write within a single permission key, matching
 * Wave 0D-2/0D-3's existing scope-only granularity). Only the scope tags
 * (OWN/ORG/ASG/PUB/COND) and role-specific COND applicability are role-
 * partitioned here.
 *
 * Multiple scopes listed for a SINGLE role (e.g. resource.progress.manage_own
 * ROLE_LEARNER: [OWN, COND]) are mandatory AND for that role — this is
 * unchanged from Wave 0D-3. What changes is that a DIFFERENT role's scopes
 * for the same key (e.g. ROLE_BUSINESS: [ORG] on account.profile.read_update_own)
 * are never combined with another role's — only the current principal's own
 * role entry is ever evaluated.
 */
export interface RolePolicy {
  /** Mandatory (AND) scope requirements for this specific role on this permission key. */
  readonly scopes: readonly ScopeType[];
  /**
   * COND ids (see ConditionRegistry) applicable when evaluating COND for
   * THIS role only. Absent/empty when this role's policy has no COND
   * scope, even if other roles on the same key do.
   */
  readonly conditionIds?: readonly string[];
}

export type PermissionRolePolicies = Readonly<Partial<Record<Role, RolePolicy>>>;

export const ROLE_POLICIES: Readonly<Record<PermissionKey, PermissionRolePolicies>> = {
  "public.content.read": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_BUSINESS: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_MENTOR: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_CONSULTANT: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "auth.learner.register": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M"
  },
  "auth.business.register": {
    ROLE_BUSINESS: { scopes: [] }, // RBAC v1.0 §6: "C"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M"
  },
  "account.profile.read_update_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "V/U OWN"
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "V/U ORG"
    ROLE_MENTOR: { scopes: ["OWN"] }, // RBAC v1.0 §6: "V/U OWN"
    ROLE_CONSULTANT: { scopes: ["OWN"] }, // RBAC v1.0 §6: "V/U OWN"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M"
  },
  "account.delete.request_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C OWN"
    ROLE_BUSINESS: { scopes: ["COND"], conditionIds: ["ACCOUNT_DELETION_NON_LEARNER_POLICY"] }, // RBAC v1.0 §6: "COND"
    ROLE_MENTOR: { scopes: ["COND"], conditionIds: ["ACCOUNT_DELETION_NON_LEARNER_POLICY"] }, // RBAC v1.0 §6: "COND"
    ROLE_CONSULTANT: { scopes: ["COND"], conditionIds: ["ACCOUNT_DELETION_NON_LEARNER_POLICY"] }, // RBAC v1.0 §6: "COND"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M"
  },
  "account.role.assign_privileged": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M"
  },
  "resource.read": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_BUSINESS: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_MENTOR: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_CONSULTANT: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "resource.bookmark.manage_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C/V/U/D OWN"
  },
  "resource.progress.manage_own": {
    ROLE_LEARNER: { scopes: ["OWN", "COND"], conditionIds: ["LEARNING_PROGRESS_FEATURE_ENABLED"] }, // RBAC v1.0 §6: "C/V/U OWN COND"
  },
  "resource.manage": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "C/V/U/D/M"
  },
  "course.read": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_BUSINESS: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_MENTOR: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_CONSULTANT: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "course.manage_approve": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M/A"
  },
  "career.read": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_BUSINESS: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_MENTOR: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_CONSULTANT: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "career.submit_own": {
    ROLE_BUSINESS: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C/U OWN"
  },
  "career.manage_moderate": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M/A"
  },
  "career_tools.read": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_BUSINESS: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_MENTOR: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_CONSULTANT: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "cv_review.use_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C/V/U OWN"
    ROLE_ADMIN: { scopes: ["COND"], conditionIds: ["CV_REVIEW_WORKFLOW_DEFINED"] }, // RBAC v1.0 §6: "COND"
  },
  "portfolio.manage_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C/V/U OWN"
  },
  "portfolio.publish_control_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "U OWN"
  },
  "portfolio.public.read": {
    ROLE_LEARNER: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_BUSINESS: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_MENTOR: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_CONSULTANT: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_ADMIN: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
  },
  "internship.program.read": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_BUSINESS: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_MENTOR: { scopes: [] }, // RBAC v1.0 §6: "V"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "internship.program.manage": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "C/V/U/M"
  },
  "internship.application.create_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C OWN"
  },
  "internship.application.read_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "V OWN"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "internship.application.review": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "R/A"
  },
  "internship.task.read_assigned": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "V OWN"
    ROLE_MENTOR: { scopes: ["ASG"] }, // RBAC v1.0 §6: "V ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "internship.task.manage_assign": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "C/V/U/M"
  },
  "submission.create_update_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C/V/U OWN"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/R"
  },
  "submission.review_assigned": {
    ROLE_MENTOR: { scopes: ["ASG"] }, // RBAC v1.0 §6: "V/R/U ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/R"
  },
  "completion.review_assigned": {
    ROLE_MENTOR: { scopes: ["ASG"] }, // RBAC v1.0 §6: "R ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "R/A"
  },
  "certificate.verify_public": {
    ROLE_LEARNER: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_BUSINESS: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_MENTOR: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_CONSULTANT: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "certificate.read_own": {
    ROLE_LEARNER: { scopes: ["OWN"] }, // RBAC v1.0 §6: "V OWN"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "certificate.issue_manage": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M/I"
  },
  "certificate.revoke": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "I"
  },
  "employer.opportunity.submit_own": {
    ROLE_BUSINESS: { scopes: ["OWN"] }, // RBAC v1.0 §6: "C/V/U OWN"
  },
  "employer.talent.discover": {
    ROLE_BUSINESS: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB/consented"
    ROLE_ADMIN: { scopes: ["PUB"] }, // RBAC v1.0 §6: "V PUB"
  },
  "employer.portal.moderate": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M/A"
  },
  "employer.communication.participate": {
    ROLE_LEARNER: { scopes: ["COND"], conditionIds: ["EMPLOYER_COMMUNICATION_PARTICIPANT"] }, // RBAC v1.0 §6: "COND"
    ROLE_BUSINESS: {
      scopes: ["ORG", "COND"],
      conditionIds: ["EMPLOYER_COMMUNICATION_PARTICIPANT"],
    }, // RBAC v1.0 §6: "C/V/U ORG COND"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "M/A"
  },
  "consulting.request.create_own": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "C ORG"
  },
  "consulting.scope.confirm_own": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "C/U ORG"
    ROLE_CONSULTANT: { scopes: ["ASG"] }, // RBAC v1.0 §6: "V ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "consulting.request.read_own": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "V ORG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "consulting.request.review_assigned": {
    ROLE_CONSULTANT: { scopes: ["ASG"] }, // RBAC v1.0 §6: "V/R/A ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/R/A/M"
  },
  "consulting.internal_note.manage": {
    ROLE_CONSULTANT: { scopes: ["ASG"] }, // RBAC v1.0 §6: "C/V/U ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "C/V/U/M"
  },
  "assessment.read_client": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "V ORG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "assessment.manage_assigned": {
    // AUTH_SCOPE is added here for BOTH roles beyond the raw §6 cell text
    // ("C/V/U/R ASG" / "V/R/M" show no such suffix — RBAC v1.0's §6 table
    // predates the AUTH_SCOPE vocabulary entirely, see Wave 0D-1). This is
    // the cross-cutting rule from RBAC v1.0 §3 ("security testing/
    // assessment permissions never authorise work outside the recorded
    // scope/environment") and §8 ("role alone is insufficient" for
    // security testing action), reinforced by State & Workflow Spec §6.2
    // ("Consultant assignment and role are necessary but not sufficient")
    // and API-AC-006 ("...regardless of role/assignment"). Applying it
    // only to Consultant and not Admin would create exactly the kind of
    // Admin bypass this framework must never have.
    ROLE_CONSULTANT: { scopes: ["ASG", "AUTH_SCOPE"] }, // RBAC v1.0 §6: "C/V/U/R ASG" + §3/§8 cross-cutting AUTH_SCOPE
    ROLE_ADMIN: { scopes: ["AUTH_SCOPE"] }, // RBAC v1.0 §6: "V/R/M" (no ASG — Admin isn't "assigned") + §3/§8 cross-cutting AUTH_SCOPE
  },
  "finding.read_client": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "V ORG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "finding.manage_assigned": {
    // See assessment.manage_assigned above: AUTH_SCOPE is the same
    // cross-cutting RBAC v1.0 §3/§8 + State & Workflow §6.2 + API-AC-006
    // requirement, not present in the raw §6 cell text for either role.
    ROLE_CONSULTANT: { scopes: ["ASG", "AUTH_SCOPE"] }, // RBAC v1.0 §6: "C/V/U/R ASG" + §3/§8 cross-cutting AUTH_SCOPE
    ROLE_ADMIN: { scopes: ["AUTH_SCOPE"] }, // RBAC v1.0 §6: "C/V/U/R/M" (no ASG) + §3/§8 cross-cutting AUTH_SCOPE
  },
  "security_score.read_client": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "V ORG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "security_score.calculate_assigned": {
    // See assessment.manage_assigned above: AUTH_SCOPE is the same
    // cross-cutting RBAC v1.0 §3/§8 + State & Workflow §6.2 + API-AC-006
    // requirement, not present in the raw §6 cell text for either role.
    ROLE_CONSULTANT: { scopes: ["ASG", "AUTH_SCOPE"] }, // RBAC v1.0 §6: "C/V/U ASG" + §3/§8 cross-cutting AUTH_SCOPE
    ROLE_ADMIN: { scopes: ["AUTH_SCOPE"] }, // RBAC v1.0 §6: "V/M/A" (no ASG) + §3/§8 cross-cutting AUTH_SCOPE
  },
  "report.read_client": {
    ROLE_BUSINESS: { scopes: ["ORG"] }, // RBAC v1.0 §6: "V ORG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "report.prepare_review_assigned": {
    ROLE_CONSULTANT: { scopes: ["ASG"] }, // RBAC v1.0 §6: "C/V/U/R ASG"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/R/M"
  },
  "report.release_client": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "A/M"
  },
  "monitoring.read_choose_own": {
    ROLE_BUSINESS: { scopes: ["ORG", "COND"], conditionIds: ["MONITORING_SUBSCRIPTION_ACTIVE"] }, // RBAC v1.0 §6: "C/V ORG COND"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "monitoring.perform_assigned": {
    ROLE_CONSULTANT: { scopes: ["ASG", "COND"], conditionIds: ["MONITORING_ASSIGNED_PLAN_ACTIVE"] }, // RBAC v1.0 §6: "R/U ASG COND"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "monitoring.admin_manage": {
    ROLE_ADMIN: { scopes: ["COND"], conditionIds: ["MONITORING_ADMIN_FEATURE_ENABLED"] }, // RBAC v1.0 §6: "M COND"
  },
  "donation.create": {
    ROLE_LEARNER: { scopes: [] }, // RBAC v1.0 §6: "C"
    ROLE_BUSINESS: { scopes: [] }, // RBAC v1.0 §6: "C"
    ROLE_MENTOR: { scopes: [] }, // RBAC v1.0 §6: "C"
    ROLE_CONSULTANT: { scopes: [] }, // RBAC v1.0 §6: "C"
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "C"
  },
  "donation.reporting.read_manage": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V/M"
  },
  "analytics.read": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  "audit.read": {
    ROLE_ADMIN: { scopes: [] }, // RBAC v1.0 §6: "V"
  },
  // audit.event.write_system is system-triggered ("Indirect" in RBAC v1.0
  // §6's Admin cell, not a direct human grant) and matches
  // PERMISSION_REGISTRY's systemOnly:true / allowedRoles:[] — no role
  // policy is defined here, consistent with that key never being directly
  // checkable against a human role (see permission-registry.ts).
  "audit.event.write_system": {},
};

/**
 * Looks up the current role's own policy for a permission key. Returns
 * `undefined` when the key has no ROLE_POLICIES entry at all (a data
 * consistency bug) or the role has no entry within it (RBAC does not grant
 * this role any resource-scoped access under this key even though it may
 * appear in the coarser PermissionDefinition.allowedRoles) — both cases
 * MUST be treated as a deny by the caller, never a role-only allow.
 */
export function getRolePolicy(key: PermissionKey, role: Role): RolePolicy | undefined {
  return ROLE_POLICIES[key]?.[role];
}
