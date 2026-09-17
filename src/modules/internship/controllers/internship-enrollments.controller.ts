import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { type TaskAssignmentInput, taskAssignmentInputSchema } from "../dto/task-assignment.dto";
import { InternshipEnrollmentService } from "../services/internship-enrollment.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit?: string): number {
  const parsed = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller()
export class InternshipEnrollmentsController {
  constructor(private readonly enrollmentService: InternshipEnrollmentService) {}

  @AuthorizeOperation("API-ENR-001")
  @Get("me/internship-enrollments")
  listOwn(
    @CurrentUser() principal: AuthPrincipal,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.enrollmentService.listOwn(principal.userId, { cursor, limit: clampLimit(limit) });
  }

  @AuthorizeOperation("API-ENR-002")
  @Get("me/internship-enrollments/:enrollmentId")
  getOwn(@Param("enrollmentId") enrollmentId: string, @CurrentUser() principal: AuthPrincipal) {
    return this.enrollmentService.getOwn(enrollmentId, principal.userId);
  }

  @AuthorizeOperation("API-ENR-003")
  @Get("me/internship-enrollments/:enrollmentId/task-assignments")
  listOwnTaskAssignments(
    @Param("enrollmentId") enrollmentId: string,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.enrollmentService.listOwnTaskAssignments(enrollmentId, principal.userId);
  }

  @AuthorizeOperation("API-ENR-005")
  @Get("admin/internship-enrollments/:enrollmentId")
  getAdmin(@Param("enrollmentId") enrollmentId: string) {
    return this.enrollmentService.getAdmin(enrollmentId);
  }

  @AuthorizeOperation("API-ENR-004")
  @Post("admin/internship-enrollments/:enrollmentId/task-assignments")
  @HttpCode(201)
  assignTasks(
    @Param("enrollmentId") enrollmentId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body(new ValidationPipe(taskAssignmentInputSchema)) body: TaskAssignmentInput,
  ) {
    return this.enrollmentService.assignTasks(enrollmentId, principal.userId, body);
  }
}
