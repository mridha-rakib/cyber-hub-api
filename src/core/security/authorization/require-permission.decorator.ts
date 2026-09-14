import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "./permission-registry";

export const PERMISSION_KEY_METADATA = "requiredPermissionKey";

/**
 * Marks a route PERMISSION_PROTECTED and declares the exact RBAC permission
 * key that guards it. The type parameter is constrained to known
 * `PermissionKey` values, so an unregistered/typo'd string cannot compile.
 *
 * This decorator only records WHICH permission key applies. Role-level
 * evaluation and (in later waves) resource-scope evaluation both happen in
 * PermissionGuard, not here.
 */
export const RequirePermission = (key: PermissionKey) => SetMetadata(PERMISSION_KEY_METADATA, key);
