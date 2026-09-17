import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type SubmissionCreateInput,
  type SubmissionResubmitInput,
  submissionCreateSchema,
  submissionResubmitSchema,
} from "../dto/submission.dto";
import { SubmissionService } from "../services/submission.service";

@Controller()
export class SubmissionsController {
  constructor(private readonly submissionService: SubmissionService) {}

  @AuthorizeOperation("API-SUB-001")
  @Post("me/task-assignments/:assignmentId/submission")
  @HttpCode(201)
  create(
    @Param("assignmentId") assignmentId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(submissionCreateSchema)) body: SubmissionCreateInput,
  ) {
    return this.submissionService.create(assignmentId, principal.userId, body);
  }

  @AuthorizeOperation("API-SUB-002")
  @Get("me/submissions/:submissionId")
  getOwn(@Param("submissionId") submissionId: string, @CurrentUser() principal: AuthPrincipal) {
    return this.submissionService.getOwn(submissionId, principal.userId);
  }

  @AuthorizeOperation("API-SUB-003")
  @HttpCode(200)
  @Post("me/submissions/:submissionId/resubmit")
  resubmit(
    @Param("submissionId") submissionId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(submissionResubmitSchema)) body: SubmissionResubmitInput,
  ) {
    return this.submissionService.resubmit(submissionId, principal.userId, body);
  }
}
