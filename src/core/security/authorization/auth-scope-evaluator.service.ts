import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AssessmentSecurityContext } from "./auth-scope.types";
import { CLOCK, type Clock } from "./clock";
import { SecurityScopeAuthorizationRepository } from "./security-scope-authorization.repository";

export interface AuthScopeEvaluationInput {
  readonly assessmentId: string;
  /**
   * Optional, explicit target/activity claim from a TRUSTED caller (a
   * future domain service that has independently validated the request —
   * never populated from raw request body/query at the generic
   * PermissionGuard integration point, since PermissionGuard has no
   * domain-specific knowledge of "target"/"activity"). When omitted,
   * activity defaults to the assessment's own documented `service`
   * (security_service_type) and target coverage falls back to requiring
   * non-empty authorized_targets data (see class doc for why: none of the
   * 9 technical operations' documented request DTOs carry a per-call
   * target parameter to check against).
   */
  readonly requestedTarget?: string;
  readonly requestedActivity?: string;
}

export interface AuthScopeEvaluationResult {
  readonly allowed: boolean;
  /** Internal diagnostic only — never returned to the client (see PermissionGuard). */
  readonly reason?: string;
}

/**
 * Real, server-side AUTH_SCOPE evaluation (Wave 0D-4B), replacing the
 * unconditional deny from Wave 0D-3/0D-4 Part A.
 *
 * Evaluates, in order, every mandatory rule from Wave 0D-4B Phase 11:
 * existence, linkage (assessment <-> authorization <-> consulting
 * request/employer), current/revoked/time validity, target coverage,
 * activity coverage. Any failure denies immediately; any missing or
 * malformed evidence denies. This class never trusts anything other than
 * what `SecurityScopeAuthorizationRepository` loaded from the DB.
 *
 * Does NOT evaluate ASG (assignment) — that remains the existing, separate
 * `evaluateAsg`/ASG resource-scope check in ScopeEvaluationService, which
 * composes with this evaluator via ordinary AND composition (Wave 0D-4B
 * Phase 16). This class also never checks `principal.role` — role-level
 * and ASG-level checks happen elsewhere in the pipeline; by the time this
 * runs, the caller has already confirmed the role/permission grant.
 */
@Injectable()
export class AuthScopeEvaluator {
  private readonly logger = new Logger(AuthScopeEvaluator.name);

  constructor(
    private readonly repository: SecurityScopeAuthorizationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async evaluate(input: AuthScopeEvaluationInput): Promise<AuthScopeEvaluationResult> {
    if (!input.assessmentId) {
      return { allowed: false, reason: "AUTH_SCOPE: no assessment locator provided" };
    }

    const context = await this.repository.loadAssessmentSecurityContext(input.assessmentId);
    if (!context) {
      return { allowed: false, reason: "AUTH_SCOPE: no assessment/authorization context resolved" };
    }

    return this.evaluateContext(context, input);
  }

  private evaluateContext(
    context: AssessmentSecurityContext,
    input: AuthScopeEvaluationInput,
  ): AuthScopeEvaluationResult {
    const auth = context.scopeAuthorization;

    // Linkage (Phase 15): the assessment and the authorization it points
    // to must genuinely belong to the same consulting request/employer.
    // "Any scope belonging to the employer" is never sufficient — the
    // SPECIFIC linked authorization must agree on both fields.
    if (auth.consultingRequestId !== context.consultingRequestId) {
      return { allowed: false, reason: "AUTH_SCOPE: consulting request linkage mismatch" };
    }
    if (auth.employerId !== context.employerId) {
      return { allowed: false, reason: "AUTH_SCOPE: employer linkage mismatch" };
    }

    // Current / revoked (Phase 9). The DB's partial unique index already
    // makes "two contradictory current rows for the same request"
    // structurally impossible, so isCurrent+revokedAt alone are sufficient
    // — no separate "superseded" lookup is needed: superseding a version
    // sets the old row's is_current to false.
    if (!auth.isCurrent) {
      return { allowed: false, reason: "AUTH_SCOPE: authorization is not current (superseded)" };
    }
    if (auth.revokedAt !== null) {
      return { allowed: false, reason: "AUTH_SCOPE: authorization has been revoked" };
    }

    // Time validity (Phase 9/12). Conservative, documented interpretation:
    // the window [valid_from, valid_until] is closed/inclusive at both
    // ends — an authorization is valid exactly AT its start and end
    // instant, not only strictly between them. Docs do not state boundary
    // exclusivity explicitly, so this is the chosen, documented
    // convention (Wave 0D-4B Phase 12).
    const now = this.clock.now();
    if (now.getTime() < auth.validFrom.getTime()) {
      return { allowed: false, reason: "AUTH_SCOPE: not yet valid (before valid_from)" };
    }
    if (auth.validUntil !== null && now.getTime() > auth.validUntil.getTime()) {
      return { allowed: false, reason: "AUTH_SCOPE: expired (after valid_until)" };
    }

    // Activity coverage (Phase 14). The only documented activity
    // discriminator grounded in the source contract is the assessment's
    // own `service` (security_service_type) — no separate per-API-ID
    // activity vocabulary is documented, so none is invented here.
    const requestedActivity = input.requestedActivity ?? context.service;
    if (!auth.allowedActivities.includes(requestedActivity)) {
      this.logger.warn(
        `AUTH_SCOPE denied — activity "${requestedActivity}" not in allowedActivities for authorization ${auth.scopeAuthorizationId}`,
      );
      return { allowed: false, reason: "AUTH_SCOPE: requested activity not covered" };
    }

    // Target coverage (Phase 13). None of the 9 technical operations'
    // documented request DTOs carry a per-call target parameter (e.g.
    // AssessmentCreateInput: "no client-supplied owner/scope"), so there
    // is no per-request target claim to match against at the generic
    // PermissionGuard integration point. When a trusted caller does
    // supply one explicitly (requestedTarget), it must be covered exactly
    // — no wildcard/subdomain/CIDR semantics, none are documented. When
    // none is supplied, this falls back to requiring genuine, non-empty
    // authorized_targets data as the minimum evidence of a real
    // authorization (an authorization with no recorded targets at all is
    // treated as incomplete/malformed for a technical operation).
    if (input.requestedTarget !== undefined) {
      if (!auth.authorizedTargets.includes(input.requestedTarget)) {
        return { allowed: false, reason: "AUTH_SCOPE: requested target not covered" };
      }
    } else if (auth.authorizedTargets.length === 0) {
      return { allowed: false, reason: "AUTH_SCOPE: no authorized targets recorded" };
    }

    return { allowed: true };
  }
}
