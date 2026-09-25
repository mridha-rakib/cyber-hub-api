import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
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
  type ReasonTransitionInput,
  reasonTransitionSchema,
  type TransitionInput,
  transitionSchema,
} from "../dto/transition.dto";
import { EmployerOpportunityService } from "../services/employer-opportunity.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller()
export class EmployerOpportunitiesController {
  constructor(private readonly opportunityService: EmployerOpportunityService) {}

  @Public()
  @Get("opportunities")
  listPublished(
    @Query("type") type?: string,
    @Query("skill") skill?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.opportunityService.listPublished({ type, skill, cursor, limit: clampLimit(limit) });
  }

  @Public()
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
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.opportunityService.listOwn(requireEmployerId(principal), {
      type,
      status,
      cursor,
      limit: clampLimit(limit),
    });
  }

  @AuthorizeOperation("API-BIZOPP-003")
  @Get("business/opportunities/:opportunityId")
  getOwn(@Param("opportunityId") opportunityId: string) {
    return this.opportunityService.getOwn(opportunityId);
  }

  @AuthorizeOperation("API-BIZOPP-004")
  @Patch("business/opportunities/:opportunityId")
  update(
    @Param("opportunityId") opportunityId: string,
    @Body(new ValidationPipe(employerOpportunityUpdateSchema)) body: EmployerOpportunityUpdateInput,
  ) {
    return this.opportunityService.update(opportunityId, body);
  }

  @AuthorizeOperation("API-BIZOPP-005")
  @HttpCode(200)
  @Post("business/opportunities/:opportunityId/resubmit")
  resubmit(
    @Param("opportunityId") opportunityId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.resubmit(opportunityId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-BIZOPP-006")
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
    @Query("status") status?: string,
    @Query("employerId") employerId?: string,
    @Query("type") type?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.opportunityService.listAdmin({
      status,
      employerId,
      type,
      cursor,
      limit: clampLimit(limit),
    });
  }

  @AuthorizeOperation("API-MOD-OPP-01")
  @HttpCode(200)
  @Post("admin/opportunities/:id/start-review")
  startReview(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.startReview(id, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-OPP-02")
  @HttpCode(200)
  @Post("admin/opportunities/:id/publish")
  publish(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.publish(id, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-MOD-OPP-03")
  @HttpCode(200)
  @Post("admin/opportunities/:id/reject")
  reject(
    @Param("id") id: string,
    @Body(new ValidationPipe(reasonTransitionSchema)) body: ReasonTransitionInput,
  ) {
    return this.opportunityService.reject(id, body.expectedStateVersion, body.reason);
  }

  @AuthorizeOperation("API-MOD-OPP-04")
  @HttpCode(200)
  @Post("admin/opportunities/:id/close")
  adminClose(
    @Param("id") id: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.opportunityService.adminClose(id, body.expectedStateVersion);
  }
}
