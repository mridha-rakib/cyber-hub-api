import { SetMetadata } from "@nestjs/common";

export const IS_AUTHENTICATED_ONLY_ROUTE = "isAuthenticatedOnlyRoute";

/**
 * Marks a route AUTHENTICATED_ONLY: it requires a valid session but has no
 * RBAC permission key from the registry (e.g. "read my own current
 * session"). Distinct from `@Public()` (no session required) and from
 * `@RequirePermission(...)` (session + a specific permission key).
 *
 * Every non-public route must carry exactly one of `@AuthenticatedOnly()`
 * or `@RequirePermission(...)`. A route with neither is treated by
 * PermissionGuard as an authorization misconfiguration and denied — see
 * permission.guard.ts's "missing metadata" rule.
 */
export const AuthenticatedOnly = () => SetMetadata(IS_AUTHENTICATED_ONLY_ROUTE, true);
