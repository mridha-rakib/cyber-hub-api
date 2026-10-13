import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
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
  type AssessmentListQuery,
  assessmentCreateInputSchema,
  assessmentListQuerySchema,
} from "../dto/security-work.dto";
import { SecurityWorkService } from "../services/security-work.service";

@Controller()
export class AssessmentController {
  constructor(private readonly work: SecurityWorkService) {}
  @AuthorizeOperation("API-ASM-001")
  @ValidateUuidRouteParams("requestId")
  @Post("consulting/requests/:requestId/assessments")
  @HttpCode(201)
  create(
    @Param("requestId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(assessmentCreateInputSchema)) _body: Record<string, never>,
  ) {
    return this.work.createAssessment(id, principal);
  }
  @AuthorizeOperation("API-ASM-002")
  @Get("assessments")
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(assessmentListQuerySchema)) query: AssessmentListQuery,
  ) {
    return this.work.listAssessments(principal, query);
  }
  @AuthorizeOperation("API-ASM-003")
  @ValidateUuidRouteParams("assessmentId")
  @Get("assessments/:assessmentId")
  get(@Param("assessmentId") id: string, @CurrentUser() principal: AuthPrincipal) {
    return this.work.getAssessment(id, principal);
  }
  @AuthorizeOperation("API-ASM-004")
  @ValidateUuidRouteParams("assessmentId")
  @Post("assessments/:assessmentId/start")
  @HttpCode(200)
  start(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.work.assessmentCommand(id, body.expectedStateVersion, principal, "start");
  }
  @AuthorizeOperation("API-ASM-005")
  @ValidateUuidRouteParams("assessmentId")
  @Post("assessments/:assessmentId/complete")
  @HttpCode(200)
  complete(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.work.assessmentCommand(id, body.expectedStateVersion, principal, "complete");
  }
  @AuthorizeOperation("API-ASM-006")
  @ValidateUuidRouteParams("assessmentId")
  @Post("admin/assessments/:assessmentId/cancel")
  @HttpCode(200)
  cancel(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reasonTransitionInputSchema)) body: ReasonTransitionInput,
  ) {
    return this.work.assessmentCommand(
      id,
      body.expectedStateVersion,
      principal,
      "cancel",
      body.reason,
    );
  }
}
