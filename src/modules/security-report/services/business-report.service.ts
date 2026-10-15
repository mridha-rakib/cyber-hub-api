import { Injectable } from "@nestjs/common";
import { NotFoundException } from "../../../core/errors/app.exception";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { requireEmployerId } from "../../career/current-employer.util";
import {
  buildConsultingCursorPage,
  CONSULTING_CURSOR_KINDS,
} from "../../consulting/pagination/consulting-pagination";
import { findingClientView } from "../../security-work/finding-client-view";
import type { BusinessReportListQuery } from "../dto/security-report.dto";
import { SecurityReportRepository } from "../repositories/security-report.repository";
import { assertReportFilePolicyConfigured } from "./report-file-policy";

type ClientReportRow = NonNullable<Awaited<ReturnType<SecurityReportRepository["clientReport"]>>>;

/**
 * SecurityReportClientView (API Contract v1.3/v1.4, D6-4). downloadAvailable
 * requires a READY SECURITY_REPORT artifact and a configured file/storage
 * policy (D6-3); neither exists while GAP-013 is open, so it is false.
 */
export function reportClientView(row: ClientReportRow) {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    status: row.status,
    versionNo: row.versionNo,
    releasedAt: row.releasedAt,
    downloadAvailable: false,
  };
}

/**
 * Business released-report reads (API-RPT-010/011/012). The employer always
 * comes from the session; every query reapplies report/assessment/request
 * employer linkage and the RELEASED/SUPERSEDED predicate, so pre-release and
 * cross-ORG reports are indistinguishable from missing ones (404).
 */
@Injectable()
export class BusinessReportService {
  constructor(private readonly reports: SecurityReportRepository) {}

  async list(principal: AuthPrincipal, query: BusinessReportListQuery) {
    const rows = await this.reports.listClientReports(requireEmployerId(principal), query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.businessReports,
      (r) => r.createdAt,
      (r) => r.id,
    );
    return { data: page.data.map(reportClientView), meta: page.meta };
  }

  /** includedFindings are read live (D6-7); the released artifact is the historical record. */
  async get(id: string, principal: AuthPrincipal) {
    const employerId = requireEmployerId(principal);
    const row = await this.visible(id, employerId);
    const findings = await this.reports.clientReportFindings(row, employerId);
    return { ...reportClientView(row), includedFindings: findings.map(findingClientView) };
  }

  /**
   * Visibility is established first, so the storage gate never reveals a
   * report the caller may not know about; then the D6-3 gate rejects with
   * 409 FILE_POLICY_NOT_CONFIGURED. No file, path or object is ever read.
   */
  async download(id: string, principal: AuthPrincipal): Promise<never> {
    await this.visible(id, requireEmployerId(principal));
    return assertReportFilePolicyConfigured();
  }

  private async visible(id: string, employerId: string) {
    const row = await this.reports.clientReport(id, employerId);
    if (!row) throw new NotFoundException();
    return row;
  }
}
