import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { CsrfGuard } from "../../../core/security/csrf/csrf.guard";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type EmployerProfileInput,
  type EmployerStatusInput,
  employerProfileInputSchema,
  employerStatusInputSchema,
  type RoleAssignmentInput,
  roleAssignmentInputSchema,
} from "../dto/admin-accounts-mutation.dto";
import {
  type AdminEmployerListQuery,
  type AdminUserListQuery,
  adminEmployerListQuerySchema,
  adminUserListQuerySchema,
} from "../dto/admin-accounts-query.dto";
import { AdminAccountsService } from "../services/admin-accounts.service";

/**
 * ROLE_ADMIN account.role.assign_privileged. Wave 7A reads (GET) and the
 * Wave 7B mutations (PATCH). Every PATCH runs CsrfGuard (API-DEC-004) after
 * the global Auth/Permission guards, so unauthenticated and non-Admin calls
 * still fail with 401/403 before CSRF is considered.
 */
@Controller()
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @AuthorizeOperation("API-ADM-001")
  @Get("admin/users")
  listUsers(@Query(new ValidationPipe(adminUserListQuerySchema)) query: AdminUserListQuery) {
    return this.accounts.listUsers(query);
  }

  @AuthorizeOperation("API-ADM-002")
  @ValidateUuidRouteParams("userId")
  @Get("admin/users/:userId")
  getUser(@Param("userId") userId: string) {
    return this.accounts.getUser(userId);
  }

  @AuthorizeOperation("API-ADM-003")
  @UseGuards(CsrfGuard)
  @ValidateUuidRouteParams("userId")
  @Patch("admin/users/:userId/role")
  changeRole(
    @Param("userId") userId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(roleAssignmentInputSchema)) body: RoleAssignmentInput,
  ) {
    return this.accounts.changeRole(userId, principal, body);
  }

  @AuthorizeOperation("API-ADM-004")
  @Get("admin/employers")
  listEmployers(
    @Query(new ValidationPipe(adminEmployerListQuerySchema)) query: AdminEmployerListQuery,
  ) {
    return this.accounts.listEmployers(query);
  }

  @AuthorizeOperation("API-ADM-005")
  @ValidateUuidRouteParams("employerId")
  @Get("admin/employers/:employerId")
  getEmployer(@Param("employerId") employerId: string) {
    return this.accounts.getEmployer(employerId);
  }

  @AuthorizeOperation("API-ADM-006")
  @UseGuards(CsrfGuard)
  @ValidateUuidRouteParams("employerId")
  @Patch("admin/employers/:employerId/profile")
  updateEmployerProfile(
    @Param("employerId") employerId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(employerProfileInputSchema)) body: EmployerProfileInput,
  ) {
    return this.accounts.updateEmployerProfile(employerId, principal, body);
  }

  @AuthorizeOperation("API-ADM-007")
  @UseGuards(CsrfGuard)
  @ValidateUuidRouteParams("employerId")
  @Patch("admin/employers/:employerId/status")
  updateEmployerStatus(
    @Param("employerId") employerId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(employerStatusInputSchema)) body: EmployerStatusInput,
  ) {
    return this.accounts.updateEmployerStatus(employerId, principal, body);
  }
}
