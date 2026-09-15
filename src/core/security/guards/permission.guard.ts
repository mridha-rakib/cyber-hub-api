import { type CanActivate, type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_AUTHENTICATED_ONLY_ROUTE } from "../../../common/decorators/authenticated-only.decorator";
import { IS_PUBLIC_ROUTE } from "../../../common/decorators/public.decorator";
import {
  AppException,
  AuthorizationMisconfiguredException,
  NotFoundException,
  PermissionDeniedException,
} from "../../errors/app.exception";
import {
  API_AUTHORIZATION_BY_ID,
  type ApiOperationAuthorization,
  isApiId,
} from "../authorization/api-authorization-map";
import type { ActorContext, OperationContext } from "../authorization/authorization-context.types";
import { API_OPERATION_METADATA } from "../authorization/authorize-operation.decorator";
import { resolveDisclosurePolicy } from "../authorization/disclosure-policy";
import { getOperationRolePolicy } from "../authorization/operation-role-policy";
import { isPermissionKey, PERMISSION_REGISTRY } from "../authorization/permission-registry";
import { PERMISSION_KEY_METADATA } from "../authorization/require-permission.decorator";
import { getRolePolicy } from "../authorization/role-policy";
import { ScopeEvaluationService } from "../authorization/scope-evaluation.service";
import type { AuthenticatedRequest } from "./auth.guard";

/**
 * Wave 0D-2 role-level RBAC enforcement, extended in Wave 0D-3 with real
 * OWN/ORG/ASG/PUB/COND resource-scope evaluation.
 *
 * Runs after the global AuthGuard (see security.module.ts's APP_GUARD
 * order), so by the time this guard executes, a public route has already
 * short-circuited and a protected route already has `request.principal`
 * populated from a DB-backed session — never from client input.
 *
 * AUTH_SCOPE evaluation is intentionally NOT implemented here — that is
 * Wave 0D-4. Any operation whose required scope includes AUTH_SCOPE is
 * still unconditionally denied by ScopeEvaluationService, regardless of
 * whether OWN/ORG/ASG/PUB/COND would otherwise pass. Do not weaken this.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly scopeEvaluation: ScopeEvaluationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.evaluate(context);
    } catch (error) {
      if (error instanceof AppException) throw error;
      // An unexpected internal failure (bad metadata shape, registry
      // lookup throwing, resolver misbehaving, etc.) must never fail open.
      this.logger.error("PermissionGuard internal failure — failing closed", error as Error);
      throw new AuthorizationMisconfiguredException();
    }
  }

  private async evaluate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const klass = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [handler, klass]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    const principal = request.principal;

    // AuthGuard (running earlier in the APP_GUARD chain) is responsible for
    // rejecting unauthenticated requests to non-public routes with 401.
    // A missing/malformed principal reaching this guard means AuthGuard
    // either wasn't applied or its contract was violated — deny rather
    // than trust an absent identity.
    if (!principal?.userId || !principal.role) {
      throw new AuthorizationMisconfiguredException(
        "Authenticated principal is missing or malformed",
      );
    }

    const isAuthenticatedOnly = this.reflector.getAllAndOverride<boolean>(
      IS_AUTHENTICATED_ONLY_ROUTE,
      [handler, klass],
    );
    const declaredPermissionKey = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY_METADATA,
      [handler, klass],
    );
    const declaredApiId = this.reflector.getAllAndOverride<string | undefined>(
      API_OPERATION_METADATA,
      [handler, klass],
    );

    // Resolve the API_AUTHORIZATION_MAP entry, if this route declares one.
    // An unknown id is a misconfiguration — never silently ignored.
    let operationEntry: ApiOperationAuthorization | undefined;
    if (declaredApiId !== undefined) {
      if (!isApiId(declaredApiId)) {
        this.logger.warn(`Denying request — unknown API operation id: ${declaredApiId}`);
        throw new AuthorizationMisconfiguredException();
      }
      operationEntry = API_AUTHORIZATION_BY_ID.get(declaredApiId);
      if (!operationEntry) {
        throw new AuthorizationMisconfiguredException();
      }

      // CALLER_DOMAIN_PERMISSION operations (API-FILE-001/002) have no
      // fixed permission key and no resolver infrastructure yet — they
      // must never become reachable via role/session alone.
      if (operationEntry.authorizationMode === "CALLER_DOMAIN_PERMISSION") {
        this.logger.warn(
          `Denying request — "${declaredApiId}" is CALLER_DOMAIN_PERMISSION and has no caller-domain resolver yet`,
        );
        throw new PermissionDeniedException();
      }

      if (
        operationEntry.permissionKey &&
        declaredPermissionKey &&
        operationEntry.permissionKey !== declaredPermissionKey
      ) {
        this.logger.warn(
          `Denying request — @AuthorizeOperation("${declaredApiId}") permission key "${operationEntry.permissionKey}" does not match @RequirePermission("${declaredPermissionKey}")`,
        );
        throw new AuthorizationMisconfiguredException();
      }
    }

    const effectivePermissionKey =
      operationEntry?.permissionKey ?? declaredPermissionKey ?? undefined;

    // Every non-public route must be explicitly classified. "No permission
    // metadata" must never silently degrade into "authenticated only" —
    // that would let a future endpoint ship under-protected by omission.
    if (!isAuthenticatedOnly && !effectivePermissionKey) {
      this.logger.warn(
        `Denying request to unclassified route ${klass.name}.${String(handler.name)} — missing @Public()/@AuthenticatedOnly()/@RequirePermission()`,
      );
      throw new AuthorizationMisconfiguredException();
    }

    if (isAuthenticatedOnly && !effectivePermissionKey) {
      return true;
    }

    if (!effectivePermissionKey || !isPermissionKey(effectivePermissionKey)) {
      this.logger.warn(
        `Denying request — unknown permission key metadata: ${String(effectivePermissionKey)}`,
      );
      throw new AuthorizationMisconfiguredException();
    }

    const definition = PERMISSION_REGISTRY[effectivePermissionKey];
    if (!definition || definition.systemOnly) {
      this.logger.warn(
        `Denying request — permission key is unregistered or system-only: ${effectivePermissionKey}`,
      );
      throw new AuthorizationMisconfiguredException();
    }

    // Role-level check. ROLE_ADMIN receives no shortcut: it must appear in
    // this specific key's allowedRoles, exactly like every other role.
    if (!definition.allowedRoles.includes(principal.role)) {
      throw new PermissionDeniedException();
    }

    // Precedence (Wave 0D-4 Part A extends the Wave 0D-3 Closure Pass):
    //   1. OPERATION_ROLE_POLICIES — the current role's operation-AND-role
    //      -specific override, when this exact (apiId, role) pair has one.
    //      This is strictly the most specific source: it exists only for
    //      the operations where API Contract v1.1's own bracket notation
    //      ("[ASG / Admin]" etc.) expresses a real per-role ALTERNATIVE
    //      that the flat operationEntry fields below cannot represent
    //      (they hold one combined value for every role listed on the
    //      operation).
    //   2. Otherwise, @AuthorizeOperation's flat API_AUTHORIZATION_MAP
    //      entry, when present — correct for every operation where all
    //      listed roles genuinely share the same requirement.
    //   3. Otherwise, the CURRENT ROLE's own entry in ROLE_POLICIES — never
    //      a role-blind union of every granted role's requirements. A role
    //      that passed the coarser `allowedRoles` check above but has no
    //      entry here is denied: `allowedRoles` only proves the role has
    //      *some* grant on this key, not what scope it must satisfy.
    // Scopes from different roles/sources are never merged — exactly one
    // of these three branches supplies the effective policy for a request.
    let scope: OperationContext["scope"];
    let resourceContextRequired: boolean;
    let assignmentRequired: boolean;
    let authScopeRequired: boolean;
    let conditionIds: readonly string[] | undefined;
    const authorizationMode = operationEntry?.authorizationMode ?? "DIRECT_PERMISSION";

    const operationRolePolicy =
      declaredApiId && isApiId(declaredApiId)
        ? getOperationRolePolicy(declaredApiId, principal.role)
        : undefined;

    if (operationRolePolicy) {
      scope = operationRolePolicy.scopes;
      resourceContextRequired = operationRolePolicy.resourceContextRequired;
      assignmentRequired = operationRolePolicy.assignmentRequired;
      authScopeRequired = operationRolePolicy.authScopeRequired;
      conditionIds =
        operationRolePolicy.conditionIds ??
        getRolePolicy(effectivePermissionKey, principal.role)?.conditionIds;
    } else if (operationEntry) {
      scope = operationEntry.scope;
      resourceContextRequired = operationEntry.resourceContextRequired;
      assignmentRequired = operationEntry.assignmentRequired;
      authScopeRequired = operationEntry.authScopeRequired;
      // The 209-op map doesn't carry condition ids of its own; when an
      // operation-level route needs COND, fall back to the role's own
      // mapping rather than inventing operation-level condition data.
      conditionIds = getRolePolicy(effectivePermissionKey, principal.role)?.conditionIds;
    } else {
      const rolePolicy = getRolePolicy(effectivePermissionKey, principal.role);
      if (!rolePolicy) {
        this.logger.warn(
          `Denying request — no role policy for role "${principal.role}" on permission "${effectivePermissionKey}"`,
        );
        throw new PermissionDeniedException();
      }
      scope = rolePolicy.scopes;
      resourceContextRequired = scope.some(
        (s) => s === "OWN" || s === "ORG" || s === "ASG" || s === "PUB",
      );
      assignmentRequired = scope.includes("ASG");
      authScopeRequired = scope.includes("AUTH_SCOPE");
      conditionIds = rolePolicy.conditionIds;
    }

    if (scope.length === 0) {
      return true;
    }

    const actor: ActorContext = {
      userId: principal.userId,
      role: principal.role,
      employerId: principal.employerId,
    };
    const operation: OperationContext = {
      apiId: declaredApiId ?? null,
      permissionKey: effectivePermissionKey,
      scope,
      resourceContextRequired,
      assignmentRequired,
      authScopeRequired,
      authorizationMode,
      conditionIds,
    };

    const routeParams = (request.params ?? {}) as Readonly<Record<string, string>>;
    const result = await this.scopeEvaluation.resolveAndEvaluate(
      { actor, operation },
      definition.domain,
      routeParams,
    );

    if (!result.allowed) {
      this.logger.warn(
        `Denying request — scope evaluation failed for "${effectivePermissionKey}": ${result.reason ?? "unspecified"}`,
      );

      // Wave 0D-5 (Phase 6/7/20). A confirmed-absent resource is always an
      // unconditional 404 — this is a fact about the resource, not a
      // disclosure-policy choice, and applies regardless of the
      // operation's sensitivity classification.
      if (result.outcome === "NOT_FOUND") {
        throw new NotFoundException();
      }

      // Otherwise: authenticated, resource resolution did not affirmatively
      // report "absent" (found-but-forbidden, or resolution unavailable —
      // both fail closed identically), so the operation's own disclosure
      // policy decides whether admitting a forbidden decision would itself
      // leak sensitive existence. CONCEAL_EXISTENCE -> generic 404;
      // DISCLOSE_FORBIDDEN/NOT_APPLICABLE -> ordinary 403. Never applied to
      // the earlier role-check failure above: that branch responds
      // identically for every resource id (existing or not), so it leaks
      // no resource-specific existence signal and stays a plain 403.
      const disclosurePolicy = resolveDisclosurePolicy(
        effectivePermissionKey,
        declaredApiId ?? null,
        resourceContextRequired,
      );
      if (disclosurePolicy === "CONCEAL_EXISTENCE") {
        throw new NotFoundException();
      }
      throw new PermissionDeniedException();
    }

    return true;
  }
}
