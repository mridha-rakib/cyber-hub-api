import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { JobsRepository } from "../repositories/jobs.repository";

/**
 * Resolves `ResourceContext` for the `"career"` permission domain
 * (`career.submit_own` — the only Career permission key that ever needs
 * resource context; `career.read`/`career.manage_moderate` never reach
 * this resolver, see career.module.ts's wiring comment). Route param is
 * `listingId`, locating a `jobs` row — the ORG owner is the row's own
 * `employerId`, never trusted from anywhere else.
 */
@Injectable()
export class CareerResourceResolver implements ResourceContextResolver {
  readonly resourceType = "career";

  constructor(private readonly jobsRepository: JobsRepository) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.listingId) {
      const job = await this.jobsRepository.findById(routeParams.listingId);
      if (!job) return null;
      return {
        resourceType: this.resourceType,
        resourceId: job.id,
        // Nullable on `jobs` (§7.9) for external/admin-curated listings —
        // ORG evaluation already fails closed against a non-string
        // `employerId`, so a Business actor can never claim one of these.
        employerId: job.employerId ?? undefined,
        isPublic: job.status === "PUBLISHED",
      };
    }

    // Collection/create endpoints (API-BIZCAR-001/002) have no single
    // resource to locate yet. Self-referential ORG context lets the ORG
    // check pass structurally for the actor's own employer; the actual
    // "only my org's rows" filtering is the service's own query
    // (`WHERE employer_id = :employerId`), not this resolver — exactly the
    // same pattern as InternshipResourceResolver's OWN-flavored fallback.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      employerId: actor.employerId,
    };
  }
}
