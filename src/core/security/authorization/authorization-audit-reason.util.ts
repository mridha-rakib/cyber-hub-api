import type { AuthorizationAuditReason } from "./authorization-decision.types";

/**
 * Wave 0D-7 Phase 6. Maps `ScopeEvaluationResult.reason` (a free-text
 * string intended only for internal Logger output — see
 * scope-evaluation.service.ts's own doc comment) to a typed, safe audit
 * reason code. This is the ONLY place that free text is inspected; the
 * typed code, never the original string, is what reaches `audit_logs`.
 */
export function mapScopeFailureReasonToAuditCode(
  reason: string | undefined,
): AuthorizationAuditReason {
  if (!reason) return "OTHER_SAFE_INTERNAL_REASON";
  if (reason.startsWith("OWN:")) return "OWN_SCOPE_DENIED";
  if (reason.startsWith("ORG:")) return "ORG_SCOPE_DENIED";
  if (reason.startsWith("ASG:")) return "ASG_SCOPE_DENIED";
  if (reason.startsWith("PUB:")) return "PUB_SCOPE_DENIED";
  if (reason.startsWith("COND:")) return "COND_DENIED";
  if (reason.startsWith("AUTH_SCOPE:")) return "AUTH_SCOPE_DENIED";
  if (
    reason.includes("no resource context resolved") ||
    reason.includes("resourceContextRequired but no resource context")
  ) {
    return "RESOLVER_FAILURE";
  }
  if (reason.includes("resource not found")) return "RESOURCE_NOT_FOUND";
  return "OTHER_SAFE_INTERNAL_REASON";
}
