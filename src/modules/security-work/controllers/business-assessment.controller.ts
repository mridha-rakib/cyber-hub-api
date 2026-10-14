import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type BusinessAssessmentListQuery,
  businessAssessmentListQuerySchema,
} from "../dto/security-work.dto";
import { SecurityWorkService } from "../services/security-work.service";

/** Business client-safe assessment reads (API-ASM-007/008, own ORG only). */
@Controller()
export class BusinessAssessmentController {
  constructor(private readonly work: SecurityWorkService) {}
  @AuthorizeOperation("API-ASM-007")
  @Get("business/security/assessments")
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(businessAssessmentListQuerySchema))
    query: BusinessAssessmentListQuery,
  ) {
    return this.work.listClientAssessments(principal, query);
  }
  @AuthorizeOperation("API-ASM-008")
  @ValidateUuidRouteParams("assessmentId")
  @Get("business/security/assessments/:assessmentId")
  get(@Param("assessmentId") id: string, @CurrentUser() principal: AuthPrincipal) {
    return this.work.getClientAssessment(id, principal);
  }
}
