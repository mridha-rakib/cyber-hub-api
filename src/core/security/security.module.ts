import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../../modules/auth/auth.module";
import { AuthGuard } from "./guards/auth.guard";
import { PermissionGuard } from "./guards/permission.guard";

/**
 * Central authorization/security wiring for the whole application.
 *
 * Registers AuthGuard and PermissionGuard as global `APP_GUARD` providers,
 * in this exact array order, so every route is protected by default:
 *
 *   1. AuthGuard       — establishes `request.principal` from the DB-backed
 *                         session, or allows straight through for
 *                         `@Public()` routes. Throws 401 otherwise.
 *   2. PermissionGuard — deny-by-default RBAC enforcement consuming the
 *                         principal AuthGuard set. See permission.guard.ts.
 *
 * Declaring both APP_GUARD entries in the same providers array (rather than
 * splitting them across modules) is deliberate: NestJS preserves provider
 * declaration order within one array for multi-providers, which is the only
 * ordering guarantee this Wave depends on — PermissionGuard must never run
 * before AuthGuard has had a chance to populate (or reject) the principal.
 * ThrottlerGuard remains registered separately in AppModule; its relative
 * order against these two is not security-relevant (it depends only on
 * request/IP metadata, never on the authenticated principal).
 *
 * `@Public()` opts a route out of authentication entirely (still consumed
 * by PermissionGuard's public-route check for defense in depth).
 * `@AuthenticatedOnly()` and `@RequirePermission(...)` classify every other
 * route — see permission.guard.ts for what happens when neither is present.
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class SecurityModule {}
