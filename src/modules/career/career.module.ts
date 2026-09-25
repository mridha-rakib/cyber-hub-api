import { Module } from "@nestjs/common";
import { EmployersRepository } from "../auth/repositories/employers.repository";
import { CareerListingsController } from "./controllers/career-listings.controller";
import { EmployerOpportunitiesController } from "./controllers/employer-opportunities.controller";
import { EmployerOpportunitiesRepository } from "./repositories/employer-opportunities.repository";
import { JobsRepository } from "./repositories/jobs.repository";
import { CareerResourceResolver } from "./resolvers/career-resource.resolver";
import { EmployerOpportunityResourceResolver } from "./resolvers/employer-opportunity-resource.resolver";
import { CareerListingService } from "./services/career-listing.service";
import { EmployerOpportunityService } from "./services/employer-opportunity.service";

/**
 * Wave 3B: Career + Employer Backend vertical slice, over the Wave 3A
 * `jobs`/`employer_opportunities` persistence. Reuses the Wave 0D
 * authorization (AuthGuard/PermissionGuard, both global) and workflow
 * (registry + hand-rolled repository-level CAS, matching the
 * `InternshipsRepository` precedent) foundations as-is — this module
 * supplies only persistence, business logic, and the two
 * `ResourceContextResolver` implementations the `"career"`/`"employer"`
 * permission domains need for their one resource-context-dependent key
 * each (`career.submit_own`, `employer.opportunity.submit_own`).
 *
 * `career.read`/`public.content.read` (public list/detail/outbound) never
 * reach a resolver at all — those routes use `@Public()`, exactly like
 * `InternshipsController`'s public catalogue routes, with PUBLISHED-only
 * filtering enforced entirely in the repository/service query layer.
 * `career.manage_moderate`/`employer.portal.moderate` (Admin moderation)
 * carry `scope: []` in the API authorization map, so PermissionGuard never
 * calls a resolver for them either — Admin's own service-layer existence
 * check (`assertExistsOrThrowConflict`) is sufficient, matching
 * `InternshipProgrammeService`'s identical pattern.
 */
@Module({
  controllers: [CareerListingsController, EmployerOpportunitiesController],
  providers: [
    JobsRepository,
    EmployerOpportunitiesRepository,
    EmployersRepository,
    CareerListingService,
    EmployerOpportunityService,
    CareerResourceResolver,
    EmployerOpportunityResourceResolver,
  ],
  exports: [CareerResourceResolver, EmployerOpportunityResourceResolver],
})
export class CareerModule {}
