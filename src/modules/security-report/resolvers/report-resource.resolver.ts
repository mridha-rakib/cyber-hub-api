import { Injectable } from "@nestjs/common";
import type { ResourceContext } from "../../../core/security/authorization/authorization-context.types";
import type {
  ResourceContextResolver,
  ResourceResolutionInput,
} from "../../../core/security/authorization/resource-context-resolver";
import { SecurityWorkRepository } from "../../security-work/repositories/security-work.repository";
import { assignedContext } from "../../security-work/resolvers/security-work-resource.resolver";
import { SecurityReportRepository } from "../repositories/security-report.repository";
import { reportLinked } from "../services/security-report.service";

/**
 * Authoritative ORG + dual-ASG facts for the "report" permission domain
 * (D6-6). Assessment-scoped operations (API-RPT-001/013) resolve the
 * assessment; report-scoped operations resolve report -> assessment ->
 * request and require one employer across all three. This is the preliminary
 * guard decision; every mutation re-checks access under its row locks.
 */
@Injectable()
export class ReportResourceResolver implements ResourceContextResolver {
  readonly resourceType = "report";
  constructor(
    private readonly reports: SecurityReportRepository,
    private readonly work: SecurityWorkRepository,
  ) {}
  async resolve({ routeParams }: ResourceResolutionInput): Promise<ResourceContext | null> {
    if (routeParams.reportId) {
      const row = await this.reports.report(routeParams.reportId);
      return row && reportLinked(row)
        ? assignedContext(row, this.resourceType, row.report.id)
        : null;
    }
    if (routeParams.assessmentId) {
      const row = await this.work.assessment(routeParams.assessmentId);
      return row ? assignedContext(row, this.resourceType, row.assessment.id) : null;
    }
    // No report operation is a collection without an assessment (no global /reports).
    return null;
  }
}
