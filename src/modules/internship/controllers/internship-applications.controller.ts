import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type InternshipApplicationInput,
  internshipApplicationInputSchema,
} from "../dto/application.dto";
import {
  type ReasonTransitionInput,
  reasonTransitionSchema,
  type TransitionInput,
  transitionSchema,
} from "../dto/transition.dto";
import { InternshipApplicationService } from "../services/internship-application.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller()
export class InternshipApplicationsController {
  constructor(private readonly applicationService: InternshipApplicationService) {}

  @AuthorizeOperation("API-APP-001")
  @Post("internships/:internshipId/applications")
  @HttpCode(201)
  create(
    @Param("internshipId") internshipId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(internshipApplicationInputSchema)) body: InternshipApplicationInput,
  ) {
    return this.applicationService.create(internshipId, principal.userId, body);
  }

  @AuthorizeOperation("API-APP-002")
  @Get("me/internship-applications")
  listOwn(
    @CurrentUser() principal: AuthPrincipal,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.applicationService.listOwn(principal.userId, status, {
      cursor,
      limit: clampLimit(limit),
    });
  }

  @AuthorizeOperation("API-APP-003")
  @Get("me/internship-applications/:applicationId")
  getOwn(@Param("applicationId") applicationId: string, @CurrentUser() principal: AuthPrincipal) {
    return this.applicationService.getOwn(applicationId, principal.userId);
  }

  @AuthorizeOperation("API-APP-004")
  @Get("admin/internship-applications")
  listAdmin(
    @Query("status") status?: string,
    @Query("internshipId") internshipId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.applicationService.listAdmin(status, internshipId, {
      cursor,
      limit: clampLimit(limit),
    });
  }

  @AuthorizeOperation("API-APP-005")
  @Get("admin/internship-applications/:applicationId")
  getAdmin(@Param("applicationId") applicationId: string) {
    return this.applicationService.getAdmin(applicationId);
  }

  @AuthorizeOperation("API-APP-006")
  @HttpCode(200)
  @Post("admin/internship-applications/:applicationId/start-review")
  startReview(
    @Param("applicationId") applicationId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.applicationService.startReview(
      applicationId,
      principal.userId,
      body.expectedStateVersion,
    );
  }

  @AuthorizeOperation("API-APP-007")
  @HttpCode(200)
  @Post("admin/internship-applications/:applicationId/accept")
  accept(
    @Param("applicationId") applicationId: string,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.applicationService.accept(applicationId, body.expectedStateVersion);
  }

  @AuthorizeOperation("API-APP-008")
  @HttpCode(200)
  @Post("admin/internship-applications/:applicationId/reject")
  reject(
    @Param("applicationId") applicationId: string,
    @Body(new ValidationPipe(reasonTransitionSchema)) body: ReasonTransitionInput,
  ) {
    return this.applicationService.reject(applicationId, body.expectedStateVersion, body.reason);
  }
}
