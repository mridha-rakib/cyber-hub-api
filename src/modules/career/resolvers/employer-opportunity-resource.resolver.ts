import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { EmployerOpportunitiesRepository } from "../repositories/employer-opportunities.repository";

/**
 * Resolves `ResourceContext` for the `"employer"` permission domain
 * (`employer.opportunity.submit_own` — the only key of that domain that
 * needs resource context in Wave 3B; `employer.portal.moderate` never
 * reaches this resolver, see career.module.ts's wiring comment). Route
 * param is `opportunityId`, locating an `employer_opportunities` row —
 * every row has a required, non-null `employerId` (§7.10, no
 * external/admin-curated path exists for opportunities).
 */
@Injectable()
export class EmployerOpportunityResourceResolver implements ResourceContextResolver {
  readonly resourceType = "employer";

  constructor(private readonly opportunitiesRepository: EmployerOpportunitiesRepository) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.opportunityId) {
      const opportunity = await this.opportunitiesRepository.findById(routeParams.opportunityId);
      if (!opportunity) return null;
      return {
        resourceType: this.resourceType,
        resourceId: opportunity.id,
        employerId: opportunity.employerId,
        isPublic: opportunity.status === "PUBLISHED",
      };
    }

    // Collection/create endpoints (API-BIZOPP-001/002): self-referential
    // ORG context, same pattern as CareerResourceResolver's own fallback.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      employerId: actor.employerId,
    };
  }
}
