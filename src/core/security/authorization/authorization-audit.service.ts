import { Injectable } from "@nestjs/common";
import { AuditLogsRepository } from "../../../modules/auth/repositories/audit-logs.repository";
import { RequestContextService } from "../../request-context/request-context.service";
import type { AuthorizationDecision } from "./authorization-decision.types";

/**
 * Wave 0D-7 Phase 13. The complete, explicit allowlist of what may enter
 * `audit_logs.metadata` for an authorization-decision row. Nothing outside
 * this shape is ever written — no raw request body/query/headers, no
 * serialized Principal/ResourceContext/Error objects, no AUTH_SCOPE target/
 * activity/restriction detail (ERD §7.39: "Minimal reason/from/to/
 * transition/request references; no secrets/evidence dump").
 */
interface SafeAuthorizationAuditMetadata {
  readonly apiId: string;
  readonly permissionKey: string;
  readonly decision: "ALLOW" | "DENY";
  readonly reasonCode?: string;
  readonly evaluatedScopes: readonly string[];
  readonly disclosurePolicy: string;
  readonly workflowSensitive: boolean;
  readonly authScopeRequired: boolean;
}

function buildSafeMetadata(decision: AuthorizationDecision): SafeAuthorizationAuditMetadata {
  return {
    apiId: decision.apiId,
    permissionKey: decision.permissionKey,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    evaluatedScopes: decision.evaluatedScopes,
    disclosurePolicy: decision.disclosurePolicy,
    workflowSensitive: decision.workflowSensitive,
    authScopeRequired: decision.authScopeRequired,
  };
}

/**
 * Wave 0D-7. Central, single write path for authorization-DECISION audit
 * rows (never business/domain success events — see the module-level doc in
 * authorization-decision.types.ts). PermissionGuard normalizes a decision
 * and hands it here; this service never receives or trusts raw request
 * data, and PermissionGuard never constructs an `audit_logs` row itself.
 *
 * Reuses the existing `AuditLogsRepository` (Wave 0C) rather than
 * duplicating persistence infrastructure — this is the same table/
 * repository authentication events already write through, distinguished
 * only by its own `action` values (`authorization.allowed` /
 * `authorization.denied`), never merged with authentication-event
 * semantics.
 *
 * Failure policy (Phase 24, since the source docs do not define audit
 * durability/failure semantics beyond "append-only" — ERD §7.39 implementation
 * note): this service itself never decides fail-open vs fail-closed — it
 * simply attempts the write and lets a failure propagate as a thrown error.
 * PermissionGuard decides what to do with that failure (fail closed on the
 * ALLOW path; log-and-preserve-external-outcome on the DENY path). This
 * service also never re-invokes itself on failure — a failed write is
 * reported through the ordinary application Logger, never as another audit
 * row (Phase 25 — no recursive audit-of-audit-failure).
 */
@Injectable()
export class AuthorizationAuditService {
  constructor(
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly requestContext: RequestContextService,
  ) {}

  /** Throws on persistence failure — callers decide fail-open/closed behavior. */
  async recordDecision(decision: AuthorizationDecision): Promise<void> {
    const requestId = decision.requestId ?? this.requestContext.getRequestId();
    const metadata = buildSafeMetadata(decision);

    await this.auditLogsRepository.record({
      actorUserId: decision.actorUserId,
      actorRole: decision.actorRole,
      action: decision.decision === "ALLOW" ? "authorization.allowed" : "authorization.denied",
      // ERD §7.39: entity_type is required ("[SRC] Entity type"). When no
      // resource was authoritatively resolved (role-check denial, PUB/COND
      // policy-only checks, AUTH_SCOPE-only operations), "authorization" is
      // the honest entity type — the thing being recorded IS the
      // authorization decision itself, not a claim about an unresolved
      // domain resource.
      entityType: decision.resource?.resourceType ?? "authorization",
      entityId: decision.resource?.resourceId,
      // ERD: user_id = "Scoped subject user for investigation" — only ever
      // the authoritatively resolved resource owner, never a guess and
      // never defaulted to the actor.
      userId: decision.resource?.ownerUserId,
      // ERD: employer_id = "Scoped tenant for investigation" — the
      // resource/subject's tenant, not the actor's own employer, unless
      // they happen to be the same authoritatively resolved value.
      employerId: decision.resource?.employerId,
      metadata,
      requestId,
    });
  }
}
