import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { requireEmployerId } from "../current-employer.util";
import {
  type EmployerOpportunityInput,
  type EmployerOpportunityUpdateInput,
  employerOpportunityInputSchema,
  employerOpportunityUpdateSchema,
} from "../dto/employer-opportunity.dto";
import {
  type AdminOpportunityListQuery,
  adminOpportunityListQuerySchema,
  type OwnOpportunityListQuery,
  ownOpportunityListQuerySchema,
  type PublicOpportunityListQuery,
  publicOpportunityListQuerySchema,
} from "../dto/list-query.dto";
import {
  type ReasonTransitionInput,
  reasonTransitionSchema,
  type TransitionInput,
  transitionSchema,
} from "../dto/transition.dto";
import { EmployerOpportunityService } from "../services/employer-opportunity.service";

@Controller()
export class EmployerOpportunitiesController {
  constructor(private readonly opportunityService: EmployerOpportunityService) {}

  @Public()
  @Get("opportunities")
  listPublished(
    @Query(new ValidationPipe(publicOpportunityListQuerySchema))
    query: PublicOpportunityListQuery,
  ) {
    return this.opportunityService.listPublished(query);
  }

  @Public()
  @ValidateUuidRouteParams("opportunityId")
  @Get("opportunities/:opportunityId")
  getPublished(@Param("opportunityId") opportunityId: string) {
    return this.opportunityService.getPublished(opportunityId);
  }

  @AuthorizeOperation("API-BIZOPP-001")
  @Post("business/opportunities")
  @HttpCode(201)
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(employerOpportunityInputSchema)) body: EmployerOpportunityInput,
  ) {
    return this.opportunityService.create(requireEmployerId(principal), principal.userId, body);
  }

  @AuthorizeOperation("API-BIZOPP-002")
  @Get("business/opportunities")
  listOwn(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(ownOpportunityListQuerySchema)) query: OwnOpportunityListQuery,
  ) {
    return this.opportunityService.listOwn(requireEmployerId(principal), query);
  }

  @AuthorizeOperation("API-BIZOPP-003")
  @ValidateUuidRouteParams("opportunityId")
  @Get("business/opportunities/:opportunityId")
  getOwn(@Param("opportunityId") opportunityId: string) {
    return this.opportunityService.getOwn(opportunityId);
  }

  @AuthorizeOperation("API-BIZOPP-004")
  @ValidateUuidRouteParams("opportunityId")
  @Patch("business/opportunities/:opportunityId")
  update(
    @Param("opportunityId") opportunityId: string,
    @Body(new ValidationPipe(employerOpportunityUpdateSchema)) body: EmployerOpportunityUpdateInput,
  ) {
    return this.opportunityService.update(opportunityId, body);
  }

  @AuthorizeOperation("API-BIZOPP-005")
  @ValidateUuidRouteParams("opportunityId")
  @HttpCode(200)
  @Post("business/opportunities/:opportunityId/resubmit")
  resubmit(
    @Param("opportunityId") opportunityId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.resubmit(opportunityId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-BIZOPP-006")
  @ValidateUuidRouteParams("opportunityId")
  @HttpCode(200)
  @Post("business/opportunities/:opportunityId/close")
  close(
    @Param("opportunityId") opportunityId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.close(opportunityId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-002")
  @Get("admin/opportunities")
  listAdmin(
    @Query(new ValidationPipe(adminOpportunityListQuerySchema)) query: AdminOpportunityListQuery,
  ) {
    return this.opportunityService.listAdmin(query);
  }

  @AuthorizeOperation("API-MOD-OPP-01")
  @ValidateUuidRouteParams("id")
  @HttpCode(200)
  @Post("admin/opportunities/:id/start-review")
  startReview(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.startReview(id, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-OPP-02")
  @ValidateUuidRouteParams("id")
  @HttpCode(200)
  @Post("admin/opportunities/:id/publish")
  publish(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.publish(id, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-OPP-03")
  @ValidateUuidRouteParams("id")
  @HttpCode(200)
  @Post("admin/opportunities/:id/reject")
  reject(
    @Param("id") id: string,
    @Body(new ValidationPipe(reasonTransitionSchema)) body: ReasonTransitionInput,
  ) {
    return this.opportunityService.reject(id, body.expectedStateVersion, body.reason);
  }

  @AuthorizeOperation("API-MOD-OPP-04")
  @ValidateUuidRouteParams("id")
  @HttpCode(200)
  @Post("admin/opportunities/:id/close")
  adminClose(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.adminClose(id, body.expectedStateVersion);
  }
}
