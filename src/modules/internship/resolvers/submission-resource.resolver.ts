import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { SubmissionsRepository } from "../repositories/submissions.repository";
import { TaskAssignmentsRepository } from "../repositories/task-assignments.repository";

/**
 * Resolves `ResourceContext` for the `"submission"` permission domain
 * (`submission.create_update_own`, `submission.review_assigned`).
 *
 * ASG assignment source: `submissions.reviewer_id` is the only persisted
 * mentor-assignment fact the documented schema provides — there is no
 * separate "mentor assigned to programme/task" table. Read literally, that
 * means a submission is unclaimed (`reviewer_id IS NULL`) until a mentor
 * (or Admin) calls `start-review`, at which point `submissions.reviewer_id`
 * becomes the sole assignee. For an UNCLAIMED submission, this resolver
 * treats any Mentor/Admin actor as provisionally "assigned" so the ASG
 * check can pass structurally for the claiming action itself — the actual
 * exclusivity (only the claiming mentor, or Admin, may act afterward) is
 * enforced once `reviewer_id` is set, and the underlying `claimForReview`
 * CAS write (see `submissions.repository.ts`) is what actually prevents two
 * mentors from claiming the same submission concurrently, not this
 * resolver. This is a documented judgment call (see Wave 1 report §"Mentor
 * assignment") given the source docs do not define a pre-claim assignment
 * mechanism.
 */
@Injectable()
export class SubmissionResourceResolver implements ResourceContextResolver {
  readonly resourceType = "submission";

  constructor(
    private readonly submissionsRepository: SubmissionsRepository,
    private readonly taskAssignmentsRepository: TaskAssignmentsRepository,
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
  ) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.submissionId) {
      const submission = await this.submissionsRepository.findById(routeParams.submissionId);
      if (!submission) return null;

      const isEligibleReviewer = actor.role === "ROLE_MENTOR" || actor.role === "ROLE_ADMIN";
      const assignedUserIds = submission.reviewerId
        ? [submission.reviewerId]
        : isEligibleReviewer
          ? [actor.userId]
          : [];

      return {
        resourceType: this.resourceType,
        resourceId: submission.id,
        ownerUserId: submission.userId,
        assignedUserIds,
      };
    }

    if (routeParams.assignmentId) {
      const assignment = await this.taskAssignmentsRepository.findById(routeParams.assignmentId);
      if (!assignment) return null;
      const enrollment = await this.enrollmentsRepository.findById(assignment.enrollmentId);
      if (!enrollment) return null;

      return {
        resourceType: this.resourceType,
        resourceId: assignment.id,
        ownerUserId: enrollment.userId,
      };
    }

    // Collection endpoint (GET /review/submissions): self-referential so
    // ASG passes structurally; SubmissionReviewService's own query does the
    // real "assigned to me" (or "all" for Admin) filtering.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      ownerUserId: actor.userId,
      assignedUserIds: [actor.userId],
    };
  }
}
