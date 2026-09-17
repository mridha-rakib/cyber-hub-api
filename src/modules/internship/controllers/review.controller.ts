import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  type CompletionEvaluationInput,
  completionEvaluationSchema,
  type ReviewApprovalInput,
  type RevisionRequestInput,
  reviewApprovalSchema,
  revisionRequestSchema,
} from "../dto/review.dto";
import { type TransitionInput, transitionSchema } from "../dto/transition.dto";
import { CompletionService } from "../services/completion.service";
import { SubmissionReviewService } from "../services/submission-review.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller("review")
export class ReviewController {
  constructor(
    private readonly reviewService: SubmissionReviewService,
    private readonly completionService: CompletionService,
  ) {}

  @AuthorizeOperation("API-REV-001")
  @Get("submissions")
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.reviewService.list(
      principal.role as "ROLE_MENTOR" | "ROLE_ADMIN",
      principal.userId,
      status,
      { cursor, limit: clampLimit(limit) },
    );
  }

  @AuthorizeOperation("API-REV-002")
  @Get("submissions/:submissionId")
  get(@Param("submissionId") submissionId: string, @CurrentUser() principal: AuthPrincipal) {
    return this.reviewService.getForReview(
      submissionId,
      principal.role as "ROLE_MENTOR" | "ROLE_ADMIN",
      principal.userId,
    );
  }

  @AuthorizeOperation("API-REV-003")
  @HttpCode(200)
  @Post("submissions/:submissionId/start-review")
  startReview(
    @Param("submissionId") submissionId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(transitionSchema)) body: TransitionInput,
  ) {
    return this.reviewService.startReview(
      submissionId,
      principal.userId,
      body.expectedStateVersion,
    );
  }

  @AuthorizeOperation("API-REV-004")
  @HttpCode(200)
  @Post("submissions/:submissionId/approve")
  approve(
    @Param("submissionId") submissionId: string,
    @Body(new ValidationPipe(reviewApprovalSchema)) body: ReviewApprovalInput,
  ) {
    return this.reviewService.approve(submissionId, body.expectedStateVersion, body);
  }

  @AuthorizeOperation("API-REV-005")
  @HttpCode(200)
  @Post("submissions/:submissionId/request-revision")
  requestRevision(
    @Param("submissionId") submissionId: string,
    @Body(new ValidationPipe(revisionRequestSchema)) body: RevisionRequestInput,
  ) {
    return this.reviewService.requestRevision(submissionId, body.expectedStateVersion, body);
  }

  @AuthorizeOperation("API-COMP-001")
  @Get("internship-enrollments/:enrollmentId/completion")
  getCompletion(@Param("enrollmentId") enrollmentId: string) {
    return this.completionService.get(enrollmentId);
  }

  @AuthorizeOperation("API-COMP-002")
  @HttpCode(200)
  @Post("internship-enrollments/:enrollmentId/evaluate-completion")
  evaluateCompletion(
    @Param("enrollmentId") enrollmentId: string,
    @Body(new ValidationPipe(completionEvaluationSchema)) body: CompletionEvaluationInput,
  ) {
    return this.completionService.evaluate(enrollmentId, body);
  }
}
