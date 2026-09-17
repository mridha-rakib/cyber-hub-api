import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { SubmissionsRepository } from "../repositories/submissions.repository";

/**
 * Resolves `ResourceContext` for the `"completion"` permission domain
 * (`completion.review_assigned`). The documented schema has no persisted
 * "mentor assigned to this enrollment" fact independent of submission
 * review history, so assignment here is derived: a mentor who has reviewed
 * at least one submission under this enrollment is treated as assigned to
 * its completion evaluation; Admin is always included (oversight, per RBAC
 * §7's Admin effective-access text). If no submission has been reviewed
 * yet, any Mentor/Admin may act (same "first responder" convention as the
 * submission resolver's unclaimed case) — see Wave 1 report §"Mentor
 * assignment" for the explicit judgment call this represents.
 */
@Injectable()
export class CompletionResourceResolver implements ResourceContextResolver {
  readonly resourceType = "completion";

  constructor(
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
    private readonly submissionsRepository: SubmissionsRepository,
  ) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (!routeParams.enrollmentId) return null;

    const enrollment = await this.enrollmentsRepository.findById(routeParams.enrollmentId);
    if (!enrollment) return null;

    const reviewers = await this.submissionsRepository.findDistinctReviewersForEnrollment(
      enrollment.id,
    );
    const assignedUserIds = new Set(reviewers);
    if (actor.role === "ROLE_ADMIN") assignedUserIds.add(actor.userId);
    if (assignedUserIds.size === 0 && actor.role === "ROLE_MENTOR") {
      assignedUserIds.add(actor.userId);
    }

    return {
      resourceType: this.resourceType,
      resourceId: enrollment.id,
      assignedUserIds: [...assignedUserIds],
    };
  }
}
