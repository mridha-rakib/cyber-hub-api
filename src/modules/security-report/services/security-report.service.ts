import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  DomainValidationException,
  NotFoundException,
  PermissionDeniedException,
  StateVersionConflictException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { RequestContextService } from "../../../core/request-context/request-context.service";
import { getRolePolicy } from "../../../core/security/authorization/role-policy";
import type { WorkflowTransitionId } from "../../../core/workflow/workflow.types";
import {
  requireTransition,
  workflowConflictForVersion,
} from "../../../core/workflow/workflow-helper";
import { WORKFLOW_OPERATION_MAP } from "../../../core/workflow/workflow-operation-map";
import { WorkflowValidationService } from "../../../core/workflow/workflow-validation.service";
import type { SecurityReport } from "../../../infrastructure/database/schema";
import { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  buildConsultingCursorPage,
  CONSULTING_CURSOR_KINDS,
} from "../../consulting/pagination/consulting-pagination";
import { ConsultingRequestsRepository } from "../../consulting/repositories/consulting-requests.repository";
import { SecurityWorkRepository } from "../../security-work/repositories/security-work.repository";
import { requireAssessmentAccess } from "../../security-work/security-work-access";
import type {
  ReportCreateInput,
  ReportFindingMembershipInput,
  ReportListQuery,
  ReportReleaseInput,
  ReportSupersedeInput,
  ReportUpdateInput,
} from "../dto/security-report.dto";
import { SecurityReportRepository } from "../repositories/security-report.repository";
import { assertReportFilePolicyConfigured } from "./report-file-policy";
import { reportSummaryView, reportView } from "./security-report.views";

type ReportContext = NonNullable<Awaited<ReturnType<SecurityReportRepository["report"]>>>;
type ReportStatus = SecurityReport["status"];

const VERSION_CONSTRAINT = "security_reports_assessment_version_key";

/** Report, assessment and request must agree on the owning employer. */
export function reportLinked(row: ReportContext) {
  return (
    row.report.assessmentId === row.assessment.id &&
    row.report.employerId === row.assessment.employerId &&
    row.assessment.employerId === row.request.employerId
  );
}
/** D6-5 content guard: a JSON object with at least one property. */
export function hasReportContent(content: unknown) {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    Object.keys(content).length > 0
  );
}
function isVersionUniqueViolation(error: unknown) {
  const matches = (candidate: unknown) =>
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { code?: unknown }).code === "23505" &&
    (candidate as { constraint?: unknown }).constraint === VERSION_CONSTRAINT;
  return matches(error) || (error instanceof Error && matches(error.cause));
}
function editGuard(apiId: "API-RPT-003" | "API-RPT-004") {
  const operation = WORKFLOW_OPERATION_MAP[apiId];
  if (operation?.kind !== "EDIT_GUARD") throw new Error(`${apiId} edit guard missing`);
  return operation.allowedStates as readonly ReportStatus[];
}

/**
 * Wave 6B operational report backend (API-RPT-001..009, API-RPT-013).
 *
 * Every mutation runs in one transaction that locks consulting_request ->
 * security_assessment -> security_reports (id order), re-checks employer
 * linkage and Consultant dual ASG under those locks, then applies stateVersion
 * (409 STATE_VERSION_CONFLICT) before lifecycle guards (409 STATE_CONFLICT),
 * writes through a guarded CAS and records its audit event in the same
 * transaction. Report operations never evaluate AUTH_SCOPE (API Contract
 * v1.3); D6-5 guards apply to every role, including Admin.
 */
@Injectable()
export class SecurityReportService {
  constructor(
    private readonly reports: SecurityReportRepository,
    private readonly work: SecurityWorkRepository,
    private readonly requests: ConsultingRequestsRepository,
    private readonly transactions: TransactionManager,
    private readonly workflow: WorkflowValidationService,
    private readonly audits: AuditLogsRepository,
    private readonly context: RequestContextService,
  ) {}

  /** API-RPT-001 (WF-RPT-01). */
  async create(assessmentId: string, principal: AuthPrincipal, input: ReportCreateInput) {
    try {
      return await this.transactions.runInTransaction(async () => {
        const row = await this.lockAssessment(assessmentId);
        requireAssessmentAccess(row, principal);
        if (row.assessment.status !== "IN_PROGRESS" && row.assessment.status !== "COMPLETED")
          throw new WorkflowConflictException();
        const findingIds = input.findingIds ?? [];
        await this.requireLinkedFindings(findingIds, row.assessment.id, row.assessment.employerId);
        const transition = requireTransition("Report", "WF-RPT-01");
        const versionNo = await this.reports.nextVersionNo(assessmentId);
        const created = await this.reports.create({
          assessmentId,
          employerId: row.assessment.employerId,
          draftContent: input.draftContent,
          status: transition.to as ReportStatus,
          stateVersion: 1,
          versionNo,
          preparedByUserId: principal.userId,
        });
        await this.reports.insertMemberships(
          created.id,
          findingIds.map((findingId, sortOrder) => ({ findingId, sortOrder })),
        );
        await this.audit(principal, "API-RPT-001", created, {
          transitionId: transition.id,
          from: null,
          to: created.status,
          stateVersion: created.stateVersion,
          versionNo: created.versionNo,
          findingIds,
        });
        return this.view(created);
      });
    } catch (error) {
      // The assessment lock serializes version allocation, so this backstop
      // should be unreachable; it never retries inside the aborted transaction.
      if (isVersionUniqueViolation(error)) throw new WorkflowConflictException();
      throw error;
    }
  }

  /** API-RPT-002. */
  async get(id: string, principal: AuthPrincipal) {
    const row = await this.reports.report(id);
    if (!row || !reportLinked(row)) throw new NotFoundException();
    requireAssessmentAccess(row, principal);
    return this.view(row.report);
  }

  /** API-RPT-013: one authorized assessment's reports (no global list). */
  async list(assessmentId: string, principal: AuthPrincipal, query: ReportListQuery) {
    const row = await this.work.assessment(assessmentId);
    if (!row) throw new NotFoundException();
    requireAssessmentAccess(row, principal);
    const rows = await this.reports.list(assessmentId, row.assessment.employerId, query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.reports,
      (r) => r.createdAt,
      (r) => r.id,
    );
    return { data: page.data.map(reportSummaryView), meta: page.meta };
  }

  /** API-RPT-003: DRAFT content only. */
  async update(id: string, principal: AuthPrincipal, input: ReportUpdateInput) {
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockReport(id, principal);
      const { expectedStateVersion, ...fields } = input;
      this.version(row.report.stateVersion, expectedStateVersion);
      const allowed = editGuard("API-RPT-003");
      if (!allowed.includes(row.report.status)) throw new WorkflowConflictException();
      const updated = await this.reports.update(id, expectedStateVersion, allowed, fields);
      if (!updated) throw workflowConflictForVersion(row.report.stateVersion, expectedStateVersion);
      await this.audit(principal, "API-RPT-003", updated, {
        changedFields: Object.keys(fields).sort(),
        stateVersion: updated.stateVersion,
      });
      return this.view(updated);
    });
  }

  /** API-RPT-004: replace finding membership while DRAFT. */
  async replaceFindings(id: string, principal: AuthPrincipal, input: ReportFindingMembershipInput) {
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockReport(id, principal);
      this.version(row.report.stateVersion, input.expectedStateVersion);
      const allowed = editGuard("API-RPT-004");
      if (!allowed.includes(row.report.status)) throw new WorkflowConflictException();
      await this.requireLinkedFindings(
        input.findingIds,
        row.report.assessmentId,
        row.report.employerId,
      );
      const updated = await this.reports.update(id, input.expectedStateVersion, allowed, {});
      if (!updated)
        throw workflowConflictForVersion(row.report.stateVersion, input.expectedStateVersion);
      const existing = await this.reports.memberships(id);
      const current = new Map(existing.map(({ membership }) => [membership.findingId, membership]));
      const next = new Set(input.findingIds);
      const removedFindingIds = [...current.keys()].filter((findingId) => !next.has(findingId));
      const addedFindingIds = input.findingIds.filter((findingId) => !current.has(findingId));
      await this.reports.deleteMemberships(id, removedFindingIds);
      await this.reports.insertMemberships(
        id,
        input.findingIds
          .map((findingId, sortOrder) => ({ findingId, sortOrder }))
          .filter(({ findingId }) => !current.has(findingId)),
      );
      // Retained findings keep their includedAt; only their order follows the input.
      for (const [sortOrder, findingId] of input.findingIds.entries()) {
        const retained = current.get(findingId);
        if (retained && retained.sortOrder !== sortOrder)
          await this.reports.setSortOrder(id, findingId, sortOrder);
      }
      await this.audit(principal, "API-RPT-004", updated, {
        addedFindingIds,
        removedFindingIds,
        stateVersion: updated.stateVersion,
      });
      return this.view(updated);
    });
  }

  /** API-RPT-005 (WF-RPT-02), Consultant only. */
  async submitReview(id: string, principal: AuthPrincipal, expectedStateVersion: number) {
    this.requireRole(principal, "ROLE_CONSULTANT");
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockReport(id, principal);
      this.version(row.report.stateVersion, expectedStateVersion);
      const transition = requireTransition("Report", "WF-RPT-02");
      if (
        !transition.from.includes(row.report.status) ||
        (row.assessment.status !== "IN_PROGRESS" && row.assessment.status !== "COMPLETED")
      )
        throw new WorkflowConflictException();
      await this.requireReviewableContent(row.report);
      return this.transition(row, principal, "API-RPT-005", transition.id, expectedStateVersion);
    });
  }

  /** API-RPT-006: WF-RPT-03 (Consultant/Admin) or WF-RPT-05 (Admin only). */
  async returnToDraft(
    id: string,
    principal: AuthPrincipal,
    expectedStateVersion: number,
    reason: string,
  ) {
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockReport(id, principal);
      const operation = WORKFLOW_OPERATION_MAP["API-RPT-006"];
      if (operation?.kind !== "TRANSITION") throw new Error("API-RPT-006 mapping missing");
      const candidate = this.workflow.resolveCandidate(
        "Report",
        operation.transitionIds,
        row.report.status,
      );
      // READY_FOR_RELEASE -> DRAFT needs report.release_client (API Contract
      // v1.3 API-RPT-006); PermissionGuard does not evaluate that key.
      if (candidate === "WF-RPT-05" && !getRolePolicy("report.release_client", principal.role))
        throw new PermissionDeniedException();
      this.version(row.report.stateVersion, expectedStateVersion);
      if (!candidate) throw new WorkflowConflictException();
      return this.transition(row, principal, "API-RPT-006", candidate, expectedStateVersion, {
        reason,
      });
    });
  }

  /** API-RPT-007 (WF-RPT-04), Consultant only; records the human reviewer. */
  async markReady(id: string, principal: AuthPrincipal, expectedStateVersion: number) {
    this.requireRole(principal, "ROLE_CONSULTANT");
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockReport(id, principal);
      this.version(row.report.stateVersion, expectedStateVersion);
      const transition = requireTransition("Report", "WF-RPT-04");
      if (!transition.from.includes(row.report.status) || row.assessment.status !== "COMPLETED")
        throw new WorkflowConflictException();
      await this.requireReviewableContent(row.report);
      return this.transition(row, principal, "API-RPT-007", transition.id, expectedStateVersion, {
        reviewedByUserId: principal.userId,
      });
    });
  }

  /**
   * API-RPT-008 (WF-RPT-06), Admin only. Every authorization, version and
   * lifecycle check runs first, then the D6-3 artifact gate rejects with
   * 409 FILE_POLICY_NOT_CONFIGURED. Nothing is written: no status,
   * stateVersion, releasedAt, path, stored object or domain audit.
   */
  async release(id: string, principal: AuthPrincipal, input: ReportReleaseInput): Promise<never> {
    this.requireRole(principal, "ROLE_ADMIN");
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockReport(id, principal);
      this.version(row.report.stateVersion, input.expectedStateVersion);
      const transition = requireTransition("Report", "WF-RPT-06");
      if (!transition.from.includes(row.report.status) || row.assessment.status !== "COMPLETED")
        throw new WorkflowConflictException();
      // input.storedObjectId is deliberately never dereferenced (GAP-013).
      return assertReportFilePolicyConfigured();
    });
  }

  /** API-RPT-009 (WF-RPT-07), Admin only; explicit, never automatic (D6-8). */
  async supersede(id: string, principal: AuthPrincipal, input: ReportSupersedeInput) {
    this.requireRole(principal, "ROLE_ADMIN");
    return this.transactions.runInTransaction(async () => {
      const initial = await this.reports.report(id);
      if (!initial) throw new NotFoundException();
      const candidate = await this.reports.report(input.replacementReportId);
      const lockIds = [id];
      // Only a replacement of the same assessment is ever locked, so this
      // transaction never takes report locks outside its assessment lock.
      if (candidate && candidate.report.assessmentId === initial.report.assessmentId)
        lockIds.push(candidate.report.id);
      const row = await this.lockReport(id, principal, lockIds);
      this.version(row.report.stateVersion, input.expectedStateVersion);
      const transition = requireTransition("Report", "WF-RPT-07");
      if (!transition.from.includes(row.report.status)) throw new WorkflowConflictException();
      const replacement = await this.reports.report(input.replacementReportId);
      if (
        !replacement ||
        !reportLinked(replacement) ||
        replacement.report.id === row.report.id ||
        replacement.report.assessmentId !== row.report.assessmentId ||
        replacement.report.employerId !== row.report.employerId ||
        replacement.report.status !== "RELEASED" ||
        replacement.report.versionNo <= row.report.versionNo ||
        replacement.report.supersedesReportId !== null
      )
        throw new WorkflowConflictException();
      const updated = await this.reports.update(id, input.expectedStateVersion, transition.from, {
        status: transition.to as ReportStatus,
      });
      if (!updated)
        throw workflowConflictForVersion(row.report.stateVersion, input.expectedStateVersion);
      if (!(await this.reports.recordLineage(replacement.report.id, updated)))
        throw new WorkflowConflictException();
      await this.audit(principal, "API-RPT-009", updated, {
        transitionId: transition.id,
        from: row.report.status,
        to: updated.status,
        stateVersion: updated.stateVersion,
        oldReportId: updated.id,
        replacementReportId: replacement.report.id,
      });
      return this.view(updated);
    });
  }

  private async transition(
    row: ReportContext,
    principal: AuthPrincipal,
    apiId: string,
    transitionId: WorkflowTransitionId,
    expectedStateVersion: number,
    extra: { reviewedByUserId?: string; reason?: string } = {},
  ) {
    const transition = requireTransition("Report", transitionId);
    const updated = await this.reports.update(
      row.report.id,
      expectedStateVersion,
      transition.from,
      {
        status: transition.to as ReportStatus,
        ...(extra.reviewedByUserId ? { reviewedByUserId: extra.reviewedByUserId } : {}),
      },
    );
    if (!updated) throw workflowConflictForVersion(row.report.stateVersion, expectedStateVersion);
    await this.audit(principal, apiId, updated, {
      transitionId: transition.id,
      from: row.report.status,
      to: updated.status,
      stateVersion: updated.stateVersion,
      ...(extra.reason ? { reason: extra.reason } : {}),
    });
    return this.view(updated);
  }
  private async lockAssessment(assessmentId: string) {
    const initial = await this.work.assessment(assessmentId);
    if (!initial || !(await this.requests.lockById(initial.request.id)))
      throw new NotFoundException();
    const row = await this.work.lockAssessment(assessmentId);
    if (!row) throw new NotFoundException();
    return row;
  }
  /** Locks request -> assessment -> report rows, then re-checks linkage and access. */
  private async lockReport(id: string, principal: AuthPrincipal, reportIds: string[] = [id]) {
    const initial = await this.reports.report(id);
    if (!initial) throw new NotFoundException();
    await this.lockAssessment(initial.report.assessmentId);
    await this.reports.lockReports(reportIds);
    const row = await this.reports.report(id);
    if (!row || !reportLinked(row)) throw new NotFoundException();
    requireAssessmentAccess(row, principal);
    return row;
  }
  /** Unknown, duplicate, foreign-assessment or cross-ORG ids: one generic 422. */
  private async requireLinkedFindings(
    findingIds: readonly string[],
    assessmentId: string,
    employerId: string,
  ) {
    const distinct = new Set(findingIds);
    if (distinct.size !== findingIds.length) throw new DomainValidationException();
    const linked = await this.reports.linkedFindingIds(findingIds, assessmentId, employerId);
    if (linked.length !== distinct.size) throw new DomainValidationException();
  }
  private async requireReviewableContent(report: SecurityReport) {
    if (
      !hasReportContent(report.draftContent) ||
      (await this.reports.membershipCount(report.id)) < 1
    )
      throw new WorkflowConflictException();
  }
  private requireRole(principal: AuthPrincipal, role: "ROLE_ADMIN" | "ROLE_CONSULTANT") {
    if (principal.role !== role) throw new PermissionDeniedException();
  }
  private version(current: number, expected: number) {
    if (current !== expected) throw new StateVersionConflictException(current);
  }
  private async view(report: SecurityReport) {
    return reportView(report, await this.reports.memberships(report.id));
  }
  /** Safe metadata only: never draftContent, evidence, notes or storage keys. */
  private audit(
    principal: AuthPrincipal,
    apiId: string,
    report: SecurityReport,
    metadata: Record<string, unknown>,
  ) {
    return this.audits.record({
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: "security.report.mutated",
      entityType: "report",
      entityId: report.id,
      employerId: report.employerId,
      requestId: this.context.getRequestId(),
      metadata: { apiId, assessmentId: report.assessmentId, ...metadata },
    });
  }
}
