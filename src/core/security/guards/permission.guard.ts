import { type CanActivate, type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_AUTHENTICATED_ONLY_ROUTE } from "../../../common/decorators/authenticated-only.decorator";
import { IS_PUBLIC_ROUTE } from "../../../common/decorators/public.decorator";
import {
  AppException,
  AuthorizationMisconfiguredException,
  PermissionDeniedException,
} from "../../errors/app.exception";
import { isPermissionKey, PERMISSION_REGISTRY } from "../authorization/permission-registry";
import { PERMISSION_KEY_METADATA } from "../authorization/require-permission.decorator";
import type { AuthenticatedRequest } from "./auth.guard";

/**
 * Wave 0D-2 deny-by-default RBAC enforcement.
 *
 * Runs after the global AuthGuard (see security.module.ts's APP_GUARD
 * order), so by the time this guard executes, a public route has already
 * short-circuited and a protected route already has `request.principal`
 * populated from a DB-backed session — never from client input.
 *
 * THIS GUARD DOES ROLE-LEVEL ENFORCEMENT ONLY. Resource-scope evaluation
 * (OWN/ORG/ASG/PUB/COND/AUTH_SCOPE) is intentionally NOT implemented here —
 * that is Wave 0D-3 (OWN/ORG/ASG/PUB/COND) and Wave 0D-4 (AUTH_SCOPE). A
 * permission key that RBAC v1.0 attaches any scope to can never be
 * role-only allowed by this guard: it fails closed until the corresponding
 * evaluator exists. This is the critical safety property of this Wave —
 * see PERMISSION_REGISTRY's `scope` field and the "scope-sensitive" branch
 * below. Do not weaken it to make a route "work" before Wave 0D-3/0D-4.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    try {
      return this.evaluate(context);
    } catch (error) {
      if (error instanceof AppException) throw error;
      // An unexpected internal failure (bad metadata shape, registry
      // lookup throwing, etc.) must never fail open.
      this.logger.error("PermissionGuard internal failure — failing closed", error as Error);
      throw new AuthorizationMisconfiguredException();
    }
  }

  private evaluate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const klass = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [handler, klass]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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
    const permissionKey = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY_METADATA,
      [handler, klass],
    );

    // Every non-public route must be explicitly classified. "No permission
    // metadata" must never silently degrade into "authenticated only" —
    // that would let a future endpoint ship under-protected by omission.
    if (!isAuthenticatedOnly && !permissionKey) {
      this.logger.warn(
        `Denying request to unclassified route ${klass.name}.${String(handler.name)} — missing @Public()/@AuthenticatedOnly()/@RequirePermission()`,
      );
      throw new AuthorizationMisconfiguredException();
    }

    if (isAuthenticatedOnly && !permissionKey) {
      return true;
    }

    if (!permissionKey || !isPermissionKey(permissionKey)) {
      this.logger.warn(
        `Denying request — unknown permission key metadata: ${String(permissionKey)}`,
      );
      throw new AuthorizationMisconfiguredException();
    }

    const definition = PERMISSION_REGISTRY[permissionKey];
    if (!definition || definition.systemOnly) {
      this.logger.warn(
        `Denying request — permission key is unregistered or system-only: ${permissionKey}`,
      );
      throw new AuthorizationMisconfiguredException();
    }

    // Role-level check. ROLE_ADMIN receives no shortcut: it must appear in
    // this specific key's allowedRoles, exactly like every other role.
    if (!definition.allowedRoles.includes(principal.role)) {
      throw new PermissionDeniedException();
    }

    if (definition.scope.length > 0) {
      // Role grant alone is proven insufficient by RBAC v1.0/State & Workflow
      // v1.0 for any OWN/ORG/ASG/PUB/COND/AUTH_SCOPE-tagged permission. The
      // evaluators that resolve these scopes against the actual resource
      // don't exist yet (Wave 0D-3/0D-4), so this must fail closed rather
      // than convert "role has permission key" into "role may access every
      // object covered by that permission".
      this.logger.warn(
        `Denying request — permission "${permissionKey}" requires scope [${definition.scope.join(", ")}] which has no evaluator yet (AUTHORIZATION_SCOPE_NOT_IMPLEMENTED)`,
      );
      throw new PermissionDeniedException();
    }

    return true;
  }
}
