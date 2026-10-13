import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { ConsultingRequestsRepository } from "../../consulting/repositories/consulting-requests.repository";
import { SecurityWorkRepository } from "../repositories/security-work.repository";

export function assignedContext(
  row: NonNullable<Awaited<ReturnType<SecurityWorkRepository["assessment"]>>>,
  resourceType: string,
  resourceId: string,
): ResourceContext | null {
  if (row.assessment.employerId !== row.request.employerId) return null;
  return {
    resourceType,
    resourceId,
    employerId: row.assessment.employerId,
    assignedUserIds:
      row.assessment.assignedConsultantId === row.request.assignedConsultantId
        ? [row.assessment.assignedConsultantId]
        : [],
  };
}
@Injectable()
export class AssessmentResourceResolver implements ResourceContextResolver {
  readonly resourceType = "assessment";
  constructor(
    private readonly work: SecurityWorkRepository,
    private readonly requests: ConsultingRequestsRepository,
  ) {}
  async resolve({ actor, routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.requestId) {
      const row = await this.requests.findById(routeParams.requestId);
      return row
        ? {
            resourceType: this.resourceType,
            resourceId: row.id,
            employerId: row.employerId,
            assignedUserIds: row.assignedConsultantId ? [row.assignedConsultantId] : [],
          }
        : null;
    }
    if (routeParams.assessmentId) {
      const row = await this.work.assessment(routeParams.assessmentId);
      return row ? assignedContext(row, this.resourceType, row.assessment.id) : null;
    }
    return {
      resourceType: this.resourceType,
      resourceId: actor.userId,
      assignedUserIds: [actor.userId],
    };
  }
}
@Injectable()
export class FindingResourceResolver implements ResourceContextResolver {
  readonly resourceType = "finding";
  constructor(private readonly work: SecurityWorkRepository) {}
  async resolve({ routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.findingId) {
      const row = await this.work.finding(routeParams.findingId);
      return row && row.finding.employerId === row.assessment.employerId
        ? assignedContext(row, this.resourceType, row.finding.id)
        : null;
    }
    const row = routeParams.assessmentId
      ? await this.work.assessment(routeParams.assessmentId)
      : null;
    return row ? assignedContext(row, this.resourceType, row.assessment.id) : null;
  }
}
