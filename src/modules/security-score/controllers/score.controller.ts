import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type OperationalScoreListQuery,
  operationalScoreListQuerySchema,
  type ScoreCalculateInput,
  scoreCalculateInputSchema,
} from "../dto/security-score.dto";
import { SecurityScoreService } from "../services/security-score.service";

/** Operational score operations (API-SCR-001 gated calculation, API-SCR-002 history). */
@Controller()
export class ScoreController {
  constructor(private readonly scores: SecurityScoreService) {}
  @AuthorizeOperation("API-SCR-001")
  @ValidateUuidRouteParams("assessmentId")
  @Post("assessments/:assessmentId/security-scores/calculate")
  @HttpCode(201)
  calculate(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(scoreCalculateInputSchema)) body: ScoreCalculateInput,
  ) {
    return this.scores.calculate(id, principal, body);
  }
  @AuthorizeOperation("API-SCR-002")
  @ValidateUuidRouteParams("assessmentId")
  @Get("assessments/:assessmentId/security-scores")
  list(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(operationalScoreListQuerySchema)) query: OperationalScoreListQuery,
  ) {
    return this.scores.list(id, principal, query);
  }
}
