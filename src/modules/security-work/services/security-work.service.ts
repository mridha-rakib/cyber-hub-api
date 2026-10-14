import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  NotFoundException,
  PermissionDeniedException,
  StateVersionConflictException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { RequestContextService } from "../../../core/request-context/request-context.service";
import { AuthScopeEvaluator } from "../../../core/security/authorization/auth-scope-evaluator.service";
import {
  requireTransition,
  workflowConflictForVersion,
} from "../../../core/workflow/workflow-helper";
import { WORKFLOW_OPERATION_MAP } from "../../../core/workflow/workflow-operation-map";
import type {
  ConsultingRequest,
  NewSecurityAssessment,
  NewVulnerabilityFinding,
  SecurityAssessment,
  VulnerabilityFinding,
} from "../../../infrastructure/database/schema";
import { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { requireEmployerId } from "../../career/current-employer.util";
import {
  buildConsultingCursorPage,
  CONSULTING_CURSOR_KINDS,
} from "../../consulting/pagination/consulting-pagination";
import { ConsultingRequestsRepository } from "../../consulting/repositories/consulting-requests.repository";
import type {
  AssessmentListQuery,
  BusinessAssessmentListQuery,
  FindingCreateInput,
  FindingListQuery,
  FindingUpdateInput,
} from "../dto/security-work.dto";
import { SecurityWorkRepository } from "../repositories/security-work.repository";
import {
  requireAssessmentAccess,
  requireOperationalRole,
  requireRequestAccess,
} from "../security-work-access";

/** D-3 applies to every actor, including Admin, before any finding write. */
export function requireFindingMutation(
  parent: SecurityAssessment["status"],
  operation: "create" | "edit" | "command",
) {
  if (parent === "IN_PROGRESS" || (parent === "COMPLETED" && operation === "command")) return;
  throw new WorkflowConflictException();
}
function assessmentView(row: SecurityAssessment) {
  return {
    id: row.id,
    employerId: row.employerId,
    consultingRequestId: row.consultingRequestId,
    scopeAuthorizationId: row.scopeAuthorizationId,
    service: row.service,
    scopeSnapshot: row.scopeSnapshot,
    assignedConsultantId: row.assignedConsultantId,
    status: row.status,
    stateVersion: row.stateVersion,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
/** Internal (Consultant/Admin) finding projection, reused by the report detail. */
export function findingView(row: VulnerabilityFinding) {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    employerId: row.employerId,
    title: row.title,
    severity: row.severity,
    description: row.description,
    evidenceSummary: row.evidenceSummary,
    recommendation: row.recommendation,
    status: row.status,
    stateVersion: row.stateVersion,
    resolvedAt: row.resolvedAt,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
/** AssessmentClientView (API Contract v1.3): the only Business assessment projection. */
export function assessmentClientView(row: {
  id: string;
  service: SecurityAssessment["service"];
  status: SecurityAssessment["status"];
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    service: row.service,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}
type AssessmentContext = NonNullable<Awaited<ReturnType<SecurityWorkRepository["assessment"]>>>;

@Injectable()
export class SecurityWorkService {
  constructor(
    private readonly work: SecurityWorkRepository,
    private readonly requests: ConsultingRequestsRepository,
    private readonly transactions: TransactionManager,
    private readonly authScope: AuthScopeEvaluator,
    private readonly audits: AuditLogsRepository,
    private readonly context: RequestContextService,
  ) {}

  async createAssessment(requestId: string, principal: AuthPrincipal) {
    return this.transactions.runInTransaction(async () => {
      const request = await this.requests.lockById(requestId);
      if (!request) throw new NotFoundException();
      this.accessRequest(request, principal);
      const scope = await this.work.currentScope(requestId);
      if (!scope || !(await this.authScope.evaluateAssessmentCreation(requestId)).allowed)
        throw new NotFoundException();
      if (request.status !== "ACCEPTED" || !request.assignedConsultantId)
        throw new WorkflowConflictException();
      const transition = requireTransition("SecurityAssessment", "WF-ASM-01");
      const row = await this.work.createAssessment({
        employerId: request.employerId,
        consultingRequestId: request.id,
        scopeAuthorizationId: scope.id,
        service: request.requestedService,
        assignedConsultantId: request.assignedConsultantId,
        scopeSnapshot: {
          authorizedTargets: scope.authorizedTargets,
          allowedActivities: scope.allowedActivities,
          restrictions: scope.restrictions,
        },
        status: transition.to as SecurityAssessment["status"],
        stateVersion: 1,
      });
      await this.audit(principal, "API-ASM-001", row, {
        transitionId: transition.id,
        from: null,
        to: row.status,
        stateVersion: row.stateVersion,
      });
      return assessmentView(row);
    });
  }
  async listAssessments(principal: AuthPrincipal, query: AssessmentListQuery) {
    this.role(principal);
    if (principal.role !== "ROLE_ADMIN" && query.employerId) throw new PermissionDeniedException();
    const rows = await this.work.listAssessments(
      query,
      principal.role === "ROLE_CONSULTANT" ? principal.userId : undefined,
    );
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.assessments,
      (r) => r.assessment.createdAt,
      (r) => r.assessment.id,
    );
    return { data: page.data.map((r) => assessmentView(r.assessment)), meta: page.meta };
  }
  async getAssessment(id: string, principal: AuthPrincipal) {
    const row = await this.work.assessment(id);
    if (!row) throw new NotFoundException();
    this.access(row, principal);
    return assessmentView(row.assessment);
  }
  async listClientAssessments(principal: AuthPrincipal, query: BusinessAssessmentListQuery) {
    const employerId = requireEmployerId(principal);
    const rows = await this.work.listClientAssessments(employerId, query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.businessAssessments,
      (r) => r.createdAt,
      (r) => r.id,
    );
    return { data: page.data.map(assessmentClientView), meta: page.meta };
  }
  async getClientAssessment(id: string, principal: AuthPrincipal) {
    const row = await this.work.clientAssessment(id, requireEmployerId(principal));
    if (!row) throw new NotFoundException();
    return assessmentClientView(row);
  }
  async assessmentCommand(
    id: string,
    version: number,
    principal: AuthPrincipal,
    command: "start" | "complete" | "cancel",
    reason?: string,
  ) {
    if (command === "cancel" && principal.role !== "ROLE_ADMIN")
      throw new PermissionDeniedException();
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockAssessment(id);
      this.access(row, principal);
      if (command !== "cancel")
        await this.scope(row.assessment.id, row.assessment.scopeAuthorizationId);
      this.version(row.assessment.stateVersion, version);
      const transitionId =
        command === "start"
          ? "WF-ASM-02"
          : command === "complete"
            ? "WF-ASM-03"
            : row.assessment.status === "PLANNED"
              ? "WF-ASM-04"
              : "WF-ASM-05";
      const transition = requireTransition("SecurityAssessment", transitionId);
      const now = new Date();
      const fields: Partial<NewSecurityAssessment> = {
        status: transition.to as SecurityAssessment["status"],
        ...(command === "start"
          ? { startedAt: now }
          : command === "complete"
            ? { completedAt: now }
            : { cancelledAt: now }),
      };
      const updated = await this.work.updateAssessment(id, version, transition.from, fields);
      if (!updated) throw workflowConflictForVersion(row.assessment.stateVersion, version);
      await this.audit(
        principal,
        command === "start"
          ? "API-ASM-004"
          : command === "complete"
            ? "API-ASM-005"
            : "API-ASM-006",
        updated,
        {
          transitionId,
          from: row.assessment.status,
          to: updated.status,
          stateVersion: updated.stateVersion,
          ...(reason ? { reason } : {}),
        },
      );
      return assessmentView(updated);
    });
  }
  async createFinding(assessmentId: string, principal: AuthPrincipal, input: FindingCreateInput) {
    return this.transactions.runInTransaction(async () => {
      const row = await this.lockAssessment(assessmentId);
      this.access(row, principal);
      await this.scope(assessmentId, row.assessment.scopeAuthorizationId);
      requireFindingMutation(row.assessment.status, "create");
      const transition = requireTransition("Finding", "WF-FND-01");
      const created = await this.work.createFinding({
        ...input,
        assessmentId,
        employerId: row.assessment.employerId,
        createdByUserId: principal.userId,
        status: transition.to as VulnerabilityFinding["status"],
        stateVersion: 1,
      });
      await this.audit(principal, "API-FND-001", created, {
        transitionId: transition.id,
        from: null,
        to: created.status,
        stateVersion: created.stateVersion,
      });
      return findingView(created);
    });
  }
  async listFindings(assessmentId: string, principal: AuthPrincipal, query: FindingListQuery) {
    const row = await this.work.assessment(assessmentId);
    if (!row) throw new NotFoundException();
    this.access(row, principal);
    const rows = await this.work.listFindings(assessmentId, row.assessment.employerId, query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.findings,
      (r) => r.createdAt,
      (r) => r.id,
    );
    return { data: page.data.map(findingView), meta: page.meta };
  }
  async getFinding(id: string, principal: AuthPrincipal) {
    const row = await this.work.finding(id);
    if (!row || row.finding.employerId !== row.assessment.employerId) throw new NotFoundException();
    this.access(row, principal);
    return findingView(row.finding);
  }
  async editFinding(id: string, principal: AuthPrincipal, input: FindingUpdateInput) {
    return this.mutateFinding(
      id,
      principal,
      input.expectedStateVersion,
      "API-FND-004",
      async (row) => {
        requireFindingMutation(row.assessment.status, "edit");
        const operation = WORKFLOW_OPERATION_MAP["API-FND-004"];
        if (operation?.kind !== "EDIT_GUARD") throw new Error("Finding edit guard missing");
        const { expectedStateVersion, ...fields } = input;
        const updated = await this.work.updateFinding(
          id,
          expectedStateVersion,
          operation.allowedStates,
          fields,
        );
        return {
          updated,
          metadata: {
            changedFields: Object.keys(fields).sort(),
            stateVersion: updated?.stateVersion,
          },
        };
      },
    );
  }
  async findingCommand(
    id: string,
    version: number,
    principal: AuthPrincipal,
    command: "start-remediation" | "resolve" | "reopen",
    note?: string,
  ) {
    const apiId =
      command === "start-remediation"
        ? "API-FND-005"
        : command === "resolve"
          ? "API-FND-006"
          : "API-FND-007";
    return this.mutateFinding(id, principal, version, apiId, async (row) => {
      requireFindingMutation(row.assessment.status, "command");
      const transitionId =
        command === "start-remediation"
          ? "WF-FND-02"
          : command === "reopen"
            ? "WF-FND-05"
            : row.finding.status === "OPEN"
              ? "WF-FND-03"
              : "WF-FND-04";
      const transition = requireTransition("Finding", transitionId);
      const fields: Partial<NewVulnerabilityFinding> = {
        status: transition.to as VulnerabilityFinding["status"],
        ...(command === "resolve"
          ? { resolvedAt: new Date() }
          : command === "reopen"
            ? { resolvedAt: null }
            : {}),
      };
      const updated = await this.work.updateFinding(id, version, transition.from, fields);
      return {
        updated,
        metadata: {
          transitionId,
          from: row.finding.status,
          to: transition.to,
          stateVersion: updated?.stateVersion,
          ...(command === "resolve"
            ? { verificationNote: note }
            : command === "reopen"
              ? { reason: note }
              : {}),
        },
      };
    });
  }
  private async mutateFinding(
    id: string,
    principal: AuthPrincipal,
    version: number,
    apiId: string,
    apply: (
      row: NonNullable<Awaited<ReturnType<SecurityWorkRepository["finding"]>>>,
    ) => Promise<{ updated: VulnerabilityFinding | null; metadata: Record<string, unknown> }>,
  ) {
    return this.transactions.runInTransaction(async () => {
      const initial = await this.work.finding(id);
      if (!initial) throw new NotFoundException();
      await this.lockAssessment(initial.assessment.id);
      const row = await this.work.lockFinding(id);
      if (!row || row.finding.employerId !== row.assessment.employerId)
        throw new NotFoundException();
      this.access(row, principal);
      if (apiId !== "API-FND-005")
        await this.scope(row.assessment.id, row.assessment.scopeAuthorizationId);
      this.version(row.finding.stateVersion, version);
      const result = await apply(row);
      if (!result.updated) throw workflowConflictForVersion(row.finding.stateVersion, version);
      await this.audit(principal, apiId, result.updated, result.metadata);
      return findingView(result.updated);
    });
  }
  private async lockAssessment(id: string): Promise<AssessmentContext> {
    const initial = await this.work.assessment(id);
    if (!initial || !(await this.requests.lockById(initial.request.id)))
      throw new NotFoundException();
    const row = await this.work.lockAssessment(id);
    if (!row) throw new NotFoundException();
    return row;
  }
  private role(principal: AuthPrincipal) {
    requireOperationalRole(principal);
  }
  private accessRequest(request: ConsultingRequest, principal: AuthPrincipal) {
    requireRequestAccess(request, principal);
  }
  private access(row: AssessmentContext, principal: AuthPrincipal) {
    requireAssessmentAccess(row, principal);
  }
  private async scope(assessmentId: string, scopeId: string) {
    await this.work.lockScope(scopeId);
    if (!(await this.authScope.evaluate({ assessmentId })).allowed) throw new NotFoundException();
  }
  private version(current: number, expected: number) {
    if (current !== expected) throw new StateVersionConflictException(current);
  }
  private audit(
    principal: AuthPrincipal,
    apiId: string,
    row: SecurityAssessment | VulnerabilityFinding,
    metadata: Record<string, unknown>,
  ) {
    const finding = "assessmentId" in row;
    return this.audits.record({
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: finding ? "security.finding.mutated" : "security.assessment.mutated",
      entityType: finding ? "finding" : "assessment",
      entityId: row.id,
      employerId: row.employerId,
      requestId: this.context.getRequestId(),
      metadata: {
        apiId,
        ...(finding
          ? { assessmentId: row.assessmentId }
          : { consultingRequestId: row.consultingRequestId }),
        ...metadata,
      },
    });
  }
}
