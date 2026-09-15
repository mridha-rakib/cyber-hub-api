import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  securityAssessments,
  securityScopeAuthorizations,
} from "../../../infrastructure/database/schema";
import { TransactionManager } from "../../database/transaction.manager";
import type { AssessmentSecurityContext } from "./auth-scope.types";

/**
 * Parses a jsonb column's runtime value into a string array, or returns
 * `null` if it isn't one. ERD §7.29 documents `authorized_targets`/
 * `allowed_activities` only as "object/array" with no further sub-schema,
 * so an array of exact string identifiers is the most conservative
 * reading consistent with the documented examples ("Explicit
 * client-approved domains/IPs/cloud accounts/environments" /
 * "Approved testing/activity scope"). Anything else (object, null,
 * mixed-type array, missing) is treated as malformed — fail closed rather
 * than guess a different shape.
 */
function parseStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string")) return null;
  return value;
}

/**
 * Loads the authoritative, server-persisted AUTH_SCOPE context for a given
 * assessment id. This is the ONLY place raw `security_assessments`/
 * `security_scope_authorizations` rows are read for authorization
 * purposes — PermissionGuard/ScopeEvaluationService never query the DB
 * directly (Wave 0D-4B Phase 10).
 *
 * Fail-closed contract: returns `null` for every failure mode (assessment
 * not found, linked authorization not found, malformed JSON columns, or a
 * thrown DB error) — the caller treats `null` uniformly as "no
 * authoritative AUTH_SCOPE evidence available" and denies. This method
 * itself never throws.
 */
@Injectable()
export class SecurityScopeAuthorizationRepository {
  private readonly logger = new Logger(SecurityScopeAuthorizationRepository.name);

  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async loadAssessmentSecurityContext(
    assessmentId: string,
  ): Promise<AssessmentSecurityContext | null> {
    try {
      const [assessment] = await this.db
        .select()
        .from(securityAssessments)
        .where(eq(securityAssessments.id, assessmentId))
        .limit(1);
      if (!assessment) return null;

      const [scopeAuth] = await this.db
        .select()
        .from(securityScopeAuthorizations)
        .where(eq(securityScopeAuthorizations.id, assessment.scopeAuthorizationId))
        .limit(1);
      // A dangling FK should be impossible given the NOT NULL + FK
      // constraint, but a missing linked row is still treated as a deny
      // rather than assumed — defense in depth against any future
      // migration/data anomaly.
      if (!scopeAuth) return null;

      const authorizedTargets = parseStringArray(scopeAuth.authorizedTargets);
      const allowedActivities = parseStringArray(scopeAuth.allowedActivities);
      if (authorizedTargets === null || allowedActivities === null) {
        this.logger.warn(
          `security_scope_authorizations ${scopeAuth.id} has malformed authorized_targets/allowed_activities — failing closed`,
        );
        return null;
      }

      return {
        assessmentId: assessment.id,
        employerId: assessment.employerId,
        consultingRequestId: assessment.consultingRequestId,
        scopeAuthorizationId: assessment.scopeAuthorizationId,
        assignedConsultantId: assessment.assignedConsultantId,
        service: assessment.service,
        scopeAuthorization: {
          scopeAuthorizationId: scopeAuth.id,
          consultingRequestId: scopeAuth.consultingRequestId,
          employerId: scopeAuth.employerId,
          isCurrent: scopeAuth.isCurrent,
          revokedAt: scopeAuth.revokedAt,
          validFrom: scopeAuth.validFrom,
          validUntil: scopeAuth.validUntil,
          authorizedTargets,
          allowedActivities,
          restrictions: Array.isArray(scopeAuth.restrictions) ? scopeAuth.restrictions : [],
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to load AUTH_SCOPE context for assessment ${assessmentId} — failing closed`,
        error as Error,
      );
      return null;
    }
  }
}
