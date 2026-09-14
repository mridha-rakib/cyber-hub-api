import type { AuthorizationMode } from "./api-authorization-map";
import type { PermissionKey } from "./permission-registry";
import type { Role } from "./role.types";
import type { ScopeType } from "./scope.types";

/**
 * The authenticated actor, exactly as trusted downstream: DB-backed fields
 * copied out of `AuthPrincipal`, never anything read from the request body,
 * query, params, or headers.
 */
export interface ActorContext {
  readonly userId: string;
  readonly role: Role;
  readonly employerId?: string;
}

/**
 * What the current route/permission requires, resolved from
 * PERMISSION_REGISTRY (always) and, when the route also carries
 * `@AuthorizeOperation(...)`, the more precise API_AUTHORIZATION_MAP entry
 * (operation-level scope/assignment/AUTH_SCOPE flags are strictly more
 * accurate than the permission-key-level flags — see Wave 0D-2 closure's
 * AUTH_SCOPE operation-level granularity note).
 */
export interface OperationContext {
  readonly apiId: string | null;
  readonly permissionKey: PermissionKey;
  /**
   * The EFFECTIVE scope requirement already resolved for the current
   * principal's role (Wave 0D-3 Closure Pass) — never a union across other
   * roles' requirements for the same permission key. See
   * `role-policy.ts`/`getRolePolicy` for how this is derived from
   * `@AuthorizeOperation` (operation-level, authoritative when present) or
   * the permission's per-role `ROLE_POLICIES` entry (fallback).
   */
  readonly scope: readonly ScopeType[];
  readonly resourceContextRequired: boolean;
  readonly assignmentRequired: boolean;
  readonly authScopeRequired: boolean;
  readonly authorizationMode: AuthorizationMode;
  /**
   * COND ids applicable for evaluating a "COND" entry in `scope`, already
   * resolved for the current role. Undefined/empty when scope has no COND
   * or when the effective policy legitimately carries no condition ids.
   */
  readonly conditionIds?: readonly string[];
}

/**
 * Normalized, authoritative facts about the resource a request is acting
 * on, as loaded by a `ResourceContextResolver` — never copied from client
 * input. Every field here is optional because not every resource carries
 * every kind of fact (e.g. a portfolio has an owner but no assignment).
 */
export interface ResourceContext {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly ownerUserId?: string;
  readonly employerId?: string;
  readonly assignedUserIds?: readonly string[];
  readonly isPublic?: boolean;
  /**
   * Additional normalized boolean facts a COND evaluator may need (e.g.
   * `{ featureEnabled: true }`), always server-derived by the resolver.
   */
  readonly conditionFacts?: Readonly<Record<string, boolean>>;
}

export interface AuthorizationContext {
  readonly actor: ActorContext;
  readonly operation: OperationContext;
  readonly resource: ResourceContext | null;
}
