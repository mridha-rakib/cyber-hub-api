import type { ApiId } from "./api-authorization-map";
import type { AuthorizationDisclosurePolicy } from "./disclosure-policy";
import type { PermissionKey } from "./permission-registry";
import type { Role } from "./role.types";
import type { ScopeType } from "./scope.types";

/**
 * Wave 0D-7 Phase 6/30. Authorization answers "may this actor attempt this
 * operation?" — this is a DECISION about the attempt, never a claim that
 * the downstream business operation subsequently succeeded. See
 * authorization-audit.service.ts's own doc comment for the full
 * ALLOW-does-not-mean-business-success distinction (Wave 0D-6 Phase 15/
 * Wave 0D-7 critical semantic distinction).
 */
export type AuthorizationAuditDecision = "ALLOW" | "DENY";

/**
 * Typed, non-sensitive denial reason categories. Every one maps to an
 * actual branch in PermissionGuard/ScopeEvaluationService — none are
 * speculative. Never exposed to the API caller (see disclosure-policy.ts
 * for the separate external 401/403/404 mapping); this is strictly an
 * internal audit/diagnostic vocabulary.
 */
export type AuthorizationAuditReason =
  | "ROLE_NOT_ALLOWED"
  | "PERMISSION_NOT_GRANTED"
  | "POLICY_MISSING"
  | "RESOURCE_NOT_FOUND"
  | "OWN_SCOPE_DENIED"
  | "ORG_SCOPE_DENIED"
  | "ASG_SCOPE_DENIED"
  | "PUB_SCOPE_DENIED"
  | "COND_DENIED"
  | "AUTH_SCOPE_DENIED"
  | "RESOLVER_FAILURE"
  | "OTHER_SAFE_INTERNAL_REASON";

/**
 * Only the safe, already-authoritative facts a resolved `ResourceContext`
 * may contribute to an audit row — never the whole object (which may carry
 * `conditionFacts` or other domain-specific detail not cleared for audit
 * storage).
 */
export interface SafeAuditResourceContext {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly ownerUserId?: string;
  readonly employerId?: string;
}

/**
 * The single normalized shape PermissionGuard builds and hands to
 * AuthorizationAuditService — the guard never constructs a raw audit_logs
 * row itself (Phase 8).
 */
export interface AuthorizationDecision {
  readonly decision: AuthorizationAuditDecision;
  readonly reasonCode?: AuthorizationAuditReason;
  readonly apiId: ApiId;
  readonly permissionKey: PermissionKey;
  readonly actorUserId: string;
  readonly actorRole: Role;
  /** The scope types this operation's policy required (not which ones were individually checked/failed). */
  readonly evaluatedScopes: readonly ScopeType[];
  readonly resource?: SafeAuditResourceContext;
  readonly disclosurePolicy: AuthorizationDisclosurePolicy;
  readonly workflowSensitive: boolean;
  readonly authScopeRequired: boolean;
  readonly requestId?: string;
}
