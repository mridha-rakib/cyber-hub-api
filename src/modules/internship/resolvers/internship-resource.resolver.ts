import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { InternshipApplicationsRepository } from "../repositories/internship-applications.repository";
import { InternshipEnrollmentsRepository } from "../repositories/internship-enrollments.repository";
import { InternshipsRepository } from "../repositories/internships.repository";

/**
 * Resolves `ResourceContext` for the `"internship"` permission domain —
 * every permission key whose `PERMISSION_REGISTRY` entry declares
 * `domain: "internship"` (`internship.program.*`, `internship.application.*`,
 * `internship.task.read_assigned`). One resolver serves all of them because
 * the guard keys resolution purely by domain string, and these operations
 * share one route-locator vocabulary (`internshipId` | `applicationId` |
 * `enrollmentId` | none).
 *
 * Route params are locators only — every fact returned here comes from a
 * server-side row lookup, never from the param value itself beyond "which
 * row to load".
 */
@Injectable()
export class InternshipResourceResolver implements ResourceContextResolver {
  readonly resourceType = "internship";

  constructor(
    private readonly internshipsRepository: InternshipsRepository,
    private readonly applicationsRepository: InternshipApplicationsRepository,
    private readonly enrollmentsRepository: InternshipEnrollmentsRepository,
  ) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.applicationId) {
      const application = await this.applicationsRepository.findById(routeParams.applicationId);
      if (!application) return null;
      return {
        resourceType: this.resourceType,
        resourceId: application.id,
        ownerUserId: application.userId,
      };
    }

    if (routeParams.enrollmentId) {
      const enrollment = await this.enrollmentsRepository.findById(routeParams.enrollmentId);
      if (!enrollment) return null;
      return {
        resourceType: this.resourceType,
        resourceId: enrollment.id,
        ownerUserId: enrollment.userId,
      };
    }

    if (routeParams.internshipId) {
      const internship = await this.internshipsRepository.findById(routeParams.internshipId);
      if (!internship) return null;
      // CREATE-under-OWN: `internship.application.create_own` targets a
      // real, existing (published or not) programme that has no learner
      // "owner" of its own — the application about to be created is what
      // belongs to the actor. See internship.module.ts's wiring comment for
      // the full rationale; the actual PUBLISHED-only guard is enforced by
      // the workflow-guard check in InternshipApplicationService, not here.
      return {
        resourceType: this.resourceType,
        resourceId: internship.id,
        ownerUserId: actor.userId,
        isPublic: internship.status === "PUBLISHED",
      };
    }

    // Collection endpoints (e.g. GET /me/internship-applications) have no
    // single resource to locate. Self-referential context lets the OWN
    // check pass structurally; the actual "only my rows" filtering is the
    // service's own query (`WHERE user_id = :actor`), not this resolver.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      ownerUserId: actor.userId,
    };
  }
}
