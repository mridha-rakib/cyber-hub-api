import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { ConsultingRequestsRepository } from "../repositories/consulting-requests.repository";

/** Authoritative ORG + ASG facts for API-CON request resources. */
@Injectable()
export class ConsultingResourceResolver implements ResourceContextResolver {
  readonly resourceType = "consulting";

  constructor(private readonly requests: ConsultingRequestsRepository) {}

  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.requestId) {
      const request = await this.requests.findById(routeParams.requestId);
      if (!request) return null;
      return {
        resourceType: this.resourceType,
        resourceId: request.id,
        employerId: request.employerId,
        assignedUserIds: request.assignedConsultantId ? [request.assignedConsultantId] : [],
      };
    }

    // Collection/create operations resolve against the authenticated actor's
    // own ORG. Operational queue filtering remains repository-enforced.
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      employerId: actor.employerId,
    };
  }
}
