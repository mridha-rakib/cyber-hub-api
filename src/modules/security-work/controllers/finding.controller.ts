import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
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
  type FindingCreateInput,
  type FindingListQuery,
  type FindingUpdateInput,
  findingCreateInputSchema,
  findingListQuerySchema,
  findingUpdateInputSchema,
  type ResolutionInput,
  resolutionInputSchema,
} from "../dto/security-work.dto";
import { SecurityWorkService } from "../services/security-work.service";

@Controller()
export class FindingController {
  constructor(private readonly work: SecurityWorkService) {}
  @AuthorizeOperation("API-FND-001")
  @ValidateUuidRouteParams("assessmentId")
  @Post("assessments/:assessmentId/findings")
  @HttpCode(201)
  create(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(findingCreateInputSchema)) body: FindingCreateInput,
  ) {
    return this.work.createFinding(id, principal, body);
  }
  @AuthorizeOperation("API-FND-002")
  @ValidateUuidRouteParams("assessmentId")
  @Get("assessments/:assessmentId/findings")
  list(
    @Param("assessmentId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query(new ValidationPipe(findingListQuerySchema)) query: FindingListQuery,
  ) {
    return this.work.listFindings(id, principal, query);
  }
  @AuthorizeOperation("API-FND-003")
  @ValidateUuidRouteParams("findingId")
  @Get("findings/:findingId")
  get(@Param("findingId") id: string, @CurrentUser() principal: AuthPrincipal) {
    return this.work.getFinding(id, principal);
  }
  @AuthorizeOperation("API-FND-004")
  @ValidateUuidRouteParams("findingId")
  @Patch("findings/:findingId")
  edit(
    @Param("findingId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(findingUpdateInputSchema)) body: FindingUpdateInput,
  ) {
    return this.work.editFinding(id, principal, body);
  }
  @AuthorizeOperation("API-FND-005")
  @ValidateUuidRouteParams("findingId")
  @Post("findings/:findingId/start-remediation")
  @HttpCode(200)
  startRemediation(
    @Param("findingId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionInputSchema)) body: TransitionInput,
  ) {
    return this.work.findingCommand(id, body.expectedStateVersion, principal, "start-remediation");
  }
  @AuthorizeOperation("API-FND-006")
  @ValidateUuidRouteParams("findingId")
  @Post("findings/:findingId/resolve")
  @HttpCode(200)
  resolve(
    @Param("findingId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(resolutionInputSchema)) body: ResolutionInput,
  ) {
    return this.work.findingCommand(
      id,
      body.expectedStateVersion,
      principal,
      "resolve",
      body.verificationNote,
    );
  }
  @AuthorizeOperation("API-FND-007")
  @ValidateUuidRouteParams("findingId")
  @Post("findings/:findingId/reopen")
  @HttpCode(200)
  reopen(
    @Param("findingId") id: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(reasonTransitionInputSchema)) body: ReasonTransitionInput,
  ) {
    return this.work.findingCommand(
      id,
      body.expectedStateVersion,
      principal,
      "reopen",
      body.reason,
    );
  }
}
