import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type ReasonTransitionInput,
  reasonTransitionInputSchema,
  type TransitionInput,
  transitionInputSchema,
} from "../../consulting/dto/consulting.dto";
import {
  type ReportCreateInput,
  type ReportFindingMembershipInput,
  type ReportListQuery,
  type ReportUpdateInput,
  reportCreateInputSchema,
  reportFindingMembershipInputSchema,
  reportListQuerySchema,
  reportUpdateInputSchema,
} from "../dto/security-report.dto";
import { SecurityReportService } from "../services/security-report.service";

/** Operational report preparation and review (Consultant dual ASG / Admin). */
@Controller()
export class ReportController {
  constructor(private readonly reports: SecurityReportService) {}
  @AuthorizeOperation("API-RPT-001")
  @ValidateUuidRouteParams("assessmentId")
  @Post("assessments/:assessmentId/reports")
  @HttpCode(201)
  create(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reportCreateInputSchema)) body: ReportCreateInput,
  ) {
    return this.reports.create(id, principal, body);
  }
  @AuthorizeOperation("API-RPT-013")
  @ValidateUuidRouteParams("assessmentId")
  @Get("assessments/:assessmentId/reports")
  list(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(reportListQuerySchema)) query: ReportListQuery,
  ) {
    return this.reports.list(id, principal, query);
  }
  @AuthorizeOperation("API-RPT-002")
  @ValidateUuidRouteParams("reportId")
  @Get("reports/:reportId")
  get(@Param("reportId") id: string, @CurrentUser() principal: AuthPrincipal) {
    return this.reports.get(id, principal);
  }
  @AuthorizeOperation("API-RPT-003")
  @ValidateUuidRouteParams("reportId")
  @Patch("reports/:reportId")
  update(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reportUpdateInputSchema)) body: ReportUpdateInput,
  ) {
    return this.reports.update(id, principal, body);
  }
  @AuthorizeOperation("API-RPT-004")
  @ValidateUuidRouteParams("reportId")
  @Put("reports/:reportId/findings")
  replaceFindings(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reportFindingMembershipInputSchema))
    body: ReportFindingMembershipInput,
  ) {
    return this.reports.replaceFindings(id, principal, body);
  }
  @AuthorizeOperation("API-RPT-005")
  @ValidateUuidRouteParams("reportId")
  @Post("reports/:reportId/submit-review")
  @HttpCode(200)
  submitReview(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.reports.submitReview(id, principal, body.expectedStateVersion);
  }
  @AuthorizeOperation("API-RPT-006")
  @ValidateUuidRouteParams("reportId")
  @Post("reports/:reportId/return-to-draft")
  @HttpCode(200)
  returnToDraft(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reasonTransitionInputSchema)) body: ReasonTransitionInput,
  ) {
    return this.reports.returnToDraft(id, principal, body.expectedStateVersion, body.reason);
  }
  @AuthorizeOperation("API-RPT-007")
  @ValidateUuidRouteParams("reportId")
  @Post("reports/:reportId/mark-ready")
  @HttpCode(200)
  markReady(
    @Param("reportId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.reports.markReady(id, principal, body.expectedStateVersion);
  }
}
