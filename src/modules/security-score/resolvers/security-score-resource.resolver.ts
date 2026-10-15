import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { SecurityWorkRepository } from "../../security-work/repositories/security-work.repository";
import {
  assignedContext,
  collectionContext,
} from "../../security-work/resolvers/security-work-resource.resolver";

/**
 * Authoritative facts for the "security_score" permission domain.
 * Operational score routes (API-SCR-001/002) resolve the assessment and its
 * consulting request (dual ASG via assignedContext); Business collections
 * (API-SCR-003/005) authorize against the actor's own employer only, and the
 * repository reapplies employer and release predicates.
 */
@Injectable()
export class SecurityScoreResourceResolver implements ResourceContextResolver {
  readonly resourceType = "security_score";
  constructor(private readonly work: SecurityWorkRepository) {}
  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.assessmentId) {
      const row = await this.work.assessment(routeParams.assessmentId);
      return row ? assignedContext(row, this.resourceType, row.assessment.id) : null;
    }
    return collectionContext(this.resourceType, actor);
  }
}
