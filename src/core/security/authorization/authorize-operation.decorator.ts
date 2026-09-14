import { SetMetadata } from "@nestjs/common";
import type { ApiId } from "./api-authorization-map";

export const API_OPERATION_METADATA = "authorizeOperationApiId";

/**
 * Optionally attaches a route to its exact API_AUTHORIZATION_MAP entry so
 * PermissionGuard can use operation-level scope/assignmentRequired/
 * authScopeRequired (strictly more precise than the permission-registry-
 * level flags — see Wave 0D-2 closure's AUTH_SCOPE granularity note)
 * instead of falling back to the coarser permission-key-level ones.
 *
 * The API authorization map remains the single centralized contract
 * source: this decorator only records WHICH operation applies, never a
 * duplicated copy of its policy. An id that isn't in the map is a
 * misconfiguration and fails closed in PermissionGuard (see
 * PERMISSION_KEY_METADATA's sibling handling for the same pattern).
 *
 * Usage: `@AuthorizeOperation("API-PORT-002")`. Do not attach this to
 * Wave 0C's already-classified `@Public()`/`@AuthenticatedOnly()` auth
 * lifecycle routes — those have their own explicit classification and
 * gain nothing from an operation lookup.
 */
export const AuthorizeOperation = (apiId: ApiId) => SetMetadata(API_OPERATION_METADATA, apiId);
