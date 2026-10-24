import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type AdminResourceListQuery,
  adminResourceListQuerySchema,
  type PublicResourceListQuery,
  publicResourceListQuerySchema,
  type ResourceCreateInput,
  type ResourceDeleteQuery,
  type ResourceTransitionInput,
  type ResourceUpdateInput,
  resourceCreateSchema,
  resourceDeleteBodySchema,
  resourceDeleteQuerySchema,
  resourceTransitionSchema,
  resourceUpdateSchema,
} from "../dto/resource.dto";
import { ResourceService } from "../services/resource.service";

/**
 * Wave 7C Resource routes — exactly API-RES-001/002 and API-ADMRES-001..007.
 * Public reads use `@Public()` (PUBLISHED-only in SQL), like the career and
 * internship catalogues. Admin routes use `@AuthorizeOperation`, so the
 * global AuthGuard -> UuidRouteParamGuard -> PermissionGuard (ROLE_ADMIN +
 * resource.manage) -> CsrfGuard chain applies to every one of them.
 */
@Controller()
export class ResourcesController {
  constructor(private readonly resourceService: ResourceService) {}

  @Public()
  @Get("resources")
  listPublished(
    @Query(new ValidationPipe(publicResourceListQuerySchema)) query: PublicResourceListQuery,
  ) {
    return this.resourceService.listPublished(query);
  }

  @Public()
  @ValidateUuidRouteParams("resourceId")
  @Get("resources/:resourceId")
  getPublished(@Param("resourceId") resourceId: string) {
    return this.resourceService.getPublished(resourceId);
  }

  @AuthorizeOperation("API-ADMRES-001")
  @Post("admin/resources")
  @HttpCode(201)
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(resourceCreateSchema)) body: ResourceCreateInput,
  ) {
    return this.resourceService.create(principal, body);
  }

  @AuthorizeOperation("API-ADMRES-002")
  @ValidateUuidRouteParams("resourceId")
  @Patch("admin/resources/:resourceId")
  update(
    @CurrentUser() principal: AuthPrincipal,
    @Param("resourceId") resourceId: string,
    @Body(new ValidationPipe(resourceUpdateSchema)) body: ResourceUpdateInput,
  ) {
    return this.resourceService.update(resourceId, principal, body);
  }

  @AuthorizeOperation("API-ADMRES-003")
  @ValidateUuidRouteParams("resourceId")
  @HttpCode(200)
  @Post("admin/resources/:resourceId/publish")
  publish(
    @CurrentUser() principal: AuthPrincipal,
    @Param("resourceId") resourceId: string,
    @Body(new ValidationPipe(resourceTransitionSchema)) body: ResourceTransitionInput,
  ) {
    return this.resourceService.publish(resourceId, principal, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-ADMRES-004")
  @ValidateUuidRouteParams("resourceId")
  @HttpCode(200)
  @Post("admin/resources/:resourceId/archive")
  archive(
    @CurrentUser() principal: AuthPrincipal,
    @Param("resourceId") resourceId: string,
    @Body(new ValidationPipe(resourceTransitionSchema)) body: ResourceTransitionInput,
  ) {
    return this.resourceService.archive(resourceId, principal, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-ADMRES-005")
  @ValidateUuidRouteParams("resourceId")
  @HttpCode(204)
  @Delete("admin/resources/:resourceId")
  async delete(
    @CurrentUser() principal: AuthPrincipal,
    @Param("resourceId") resourceId: string,
    @Query(new ValidationPipe(resourceDeleteQuerySchema)) query: ResourceDeleteQuery,
    @Body(new ValidationPipe(resourceDeleteBodySchema)) _body: unknown,
  ) {
    await this.resourceService.delete(resourceId, principal, query.expectedStateVersion);
  }

  @AuthorizeOperation("API-ADMRES-006")
  @Get("admin/resources")
  listAdmin(
    @Query(new ValidationPipe(adminResourceListQuerySchema)) query: AdminResourceListQuery,
  ) {
    return this.resourceService.listAdmin(query);
  }

  @AuthorizeOperation("API-ADMRES-007")
  @ValidateUuidRouteParams("resourceId")
  @Get("admin/resources/:resourceId")
  getAdmin(@Param("resourceId") resourceId: string) {
    return this.resourceService.getAdmin(resourceId);
  }
}
