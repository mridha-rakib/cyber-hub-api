/**
 * Normalized, server-loaded AUTH_SCOPE facts — never raw DB rows, never
 * anything derived from client input. See
 * `security-scope-authorization.repository.ts` for how these are built
 * from `security_assessments` + `security_scope_authorizations`.
 */
export interface SecurityScopeAuthorizationContext {
  readonly scopeAuthorizationId: string;
  readonly consultingRequestId: string;
  readonly employerId: string;
  readonly isCurrent: boolean;
  readonly revokedAt: Date | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  /**
   * ERD §7.29: "object/array" with no further documented sub-schema
   * (API Contract v1.1 ScopeAuthorizationInput: "authorizedTargets |
   * object/array | Yes | Explicit client-approved domains/IPs/cloud
   * accounts/environments"). Interpreted conservatively as an array of
   * exact string identifiers — see the repository's parsing note.
   */
  readonly authorizedTargets: readonly string[];
  readonly allowedActivities: readonly string[];
  readonly restrictions: readonly unknown[];
}

export interface AssessmentSecurityContext {
  readonly assessmentId: string;
  readonly employerId: string;
  readonly consultingRequestId: string;
  readonly scopeAuthorizationId: string;
  readonly assignedConsultantId: string;
  /** security_service_type enum value — used as the documented "activity" discriminator (see AuthScopeEvaluator). */
  readonly service: string;
  readonly scopeAuthorization: SecurityScopeAuthorizationContext;
}
