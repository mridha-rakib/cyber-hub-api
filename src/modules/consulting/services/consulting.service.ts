import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  NotFoundException,
  PermissionDeniedException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import type {
  ConsultingNote,
  ConsultingRequest,
  SecurityScopeAuthorization,
} from "../../../infrastructure/database/schema";
import { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import type {
  BusinessRequestListQuery,
  ConsultingRequestInput,
  NotesListQuery,
  OperationalRequestListQuery,
  ScopeAuthorizationInputDto,
} from "../dto/consulting.dto";
import {
  buildConsultingCursorPage,
  CONSULTING_CURSOR_KINDS,
} from "../pagination/consulting-pagination";
import { ConsultingNotesRepository } from "../repositories/consulting-notes.repository";
import { ConsultingRequestsRepository } from "../repositories/consulting-requests.repository";
import { ScopeAuthorizationsRepository } from "../repositories/scope-authorizations.repository";

function toClientView(request: ConsultingRequest) {
  return {
    id: request.id,
    requestedService: request.requestedService,
    companyDetails: request.companyDetails,
    businessSize: request.businessSize,
    status: request.status,
    stateVersion: request.stateVersion,
    submittedAt: request.submittedAt,
    acceptedAt: request.acceptedAt,
    completedAt: request.completedAt,
  };
}

function toOperationalView(request: ConsultingRequest) {
  return {
    id: request.id,
    employerId: request.employerId,
    companyDetails: request.companyDetails,
    businessSize: request.businessSize,
    securityConcern: request.securityConcern,
    businessImpact: request.businessImpact,
    requestedService: request.requestedService,
    environmentDetails: request.environmentDetails,
    contactInformation: request.contactInformation,
    status: request.status,
    stateVersion: request.stateVersion,
    assignedConsultantId: request.assignedConsultantId,
    submittedAt: request.submittedAt,
    acceptedAt: request.acceptedAt,
    completedAt: request.completedAt,
  };
}

function toScopeView(scope: SecurityScopeAuthorization) {
  return {
    id: scope.id,
    versionNo: scope.versionNo,
    authorizedTargets: scope.authorizedTargets,
    allowedActivities: scope.allowedActivities,
    restrictions: scope.restrictions,
    confirmedAt: scope.confirmedAt,
    validFrom: scope.validFrom,
    validUntil: scope.validUntil,
    isCurrent: scope.isCurrent,
    supersededAt: scope.supersededAt,
    revokedAt: scope.revokedAt,
    createdAt: scope.createdAt,
  };
}

function toNoteView(note: ConsultingNote) {
  return {
    id: note.id,
    consultingRequestId: note.consultingRequestId,
    authorUserId: note.authorUserId,
    body: note.body,
    createdAt: note.createdAt,
  };
}

@Injectable()
export class ConsultingService {
  constructor(
    private readonly requests: ConsultingRequestsRepository,
    private readonly notes: ConsultingNotesRepository,
    private readonly scopes: ScopeAuthorizationsRepository,
    private readonly audits: AuditLogsRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async create(employerId: string, userId: string, input: ConsultingRequestInput) {
    requireTransition("ConsultingRequest", "WF-REQ-01");
    const created = await this.requests.create({ employerId, submittedByUserId: userId }, input);
    return toClientView(created);
  }

  async listOwn(employerId: string, query: BusinessRequestListQuery) {
    const rows = await this.requests.findOwn(employerId, query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.requests,
      (row) => row.submittedAt,
      (row) => row.id,
    );
    return { data: page.data.map(toClientView), meta: page.meta };
  }

  async getOwn(requestId: string) {
    const request = await this.requireRequest(requestId);
    return toClientView(request);
  }

  async createScope(
    requestId: string,
    employerId: string,
    userId: string,
    input: ScopeAuthorizationInputDto,
  ) {
    const created = await this.scopes.createNextVersion(
      { consultingRequestId: requestId, employerId, confirmedByUserId: userId },
      {
        authorizedTargets: input.authorizedTargets,
        allowedActivities: input.allowedActivities,
        restrictions: input.restrictions,
        validFrom: new Date(input.validFrom),
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
      },
    );
    if (!created) throw new NotFoundException();
    return toScopeView(created);
  }

  async getCurrentScope(requestId: string, employerId: string) {
    const scope = await this.scopes.getCurrent(requestId, employerId);
    if (!scope) throw new NotFoundException();
    return toScopeView(scope);
  }

  async listOperational(principal: AuthPrincipal, query: OperationalRequestListQuery) {
    if (principal.role === "ROLE_CONSULTANT" && query.employerId) {
      throw new PermissionDeniedException();
    }
    const rows =
      principal.role === "ROLE_ADMIN"
        ? await this.requests.findOperational(query)
        : await this.requests.findAssigned(principal.userId, query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.requests,
      (row) => row.submittedAt,
      (row) => row.id,
    );
    return { data: page.data.map(toOperationalView), meta: page.meta };
  }

  async getOperational(requestId: string) {
    const request = await this.requireRequest(requestId);
    const currentScope = await this.scopes.getCurrent(requestId, request.employerId);
    return {
      ...toOperationalView(request),
      currentAuthorization: currentScope ? toScopeView(currentScope) : null,
    };
  }

  async assign(requestId: string, consultantUserId: string) {
    const existing = await this.requests.findById(requestId);
    if (!existing) throw new NotFoundException();
    const assigned = await this.requests.assignConsultant(requestId, consultantUserId);
    if (!assigned) throw new NotFoundException();
    return toOperationalView(assigned);
  }

  startReview(requestId: string, version: number) {
    return this.transition(requestId, "WF-REQ-02", version);
  }

  accept(requestId: string, version: number) {
    return this.transition(requestId, "WF-REQ-03", version, { acceptedAt: new Date() });
  }

  async decline(requestId: string, version: number, reason: string, principal: AuthPrincipal) {
    return this.transactions.runInTransaction(async () => {
      const result = await this.transition(requestId, "WF-REQ-04", version);
      await this.audits.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "consulting.request.declined",
        entityType: "consulting",
        entityId: requestId,
        employerId: result.employerId,
        metadata: { reason },
      });
      return result;
    });
  }

  startDelivery(requestId: string, version: number) {
    // PermissionGuard has already enforced request-level AUTH_SCOPE. Keeping
    // the domain lookup in the authorization pipeline avoids trusting body data.
    return this.transition(requestId, "WF-REQ-05", version, {}, "AUTH_SCOPE");
  }

  async complete(requestId: string, version: number) {
    if (!(await this.requests.hasOnlyCompletedLinkedWork(requestId))) {
      throw new WorkflowConflictException();
    }
    return this.transition(
      requestId,
      "WF-REQ-06",
      version,
      { completedAt: new Date() },
      "COMPLETION",
    );
  }

  async listNotes(requestId: string, query: NotesListQuery) {
    const rows = await this.notes.listByRequest(requestId, query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.notes,
      (row) => row.createdAt,
      (row) => row.id,
    );
    return { data: page.data.map(toNoteView), meta: page.meta };
  }

  async createNote(requestId: string, authorUserId: string, body: string) {
    const note = await this.notes.create(requestId, authorUserId, body);
    return toNoteView(note);
  }

  private async transition(
    requestId: string,
    transitionId: "WF-REQ-02" | "WF-REQ-03" | "WF-REQ-04" | "WF-REQ-05" | "WF-REQ-06",
    expectedStateVersion: number,
    extra: Partial<ConsultingRequest> = {},
    guard?: "AUTH_SCOPE" | "COMPLETION",
  ) {
    const transition = requireTransition("ConsultingRequest", transitionId);
    const updated = await this.requests.transitionWithExtras(
      requestId,
      transition.from,
      transition.to,
      expectedStateVersion,
      extra,
      guard,
    );
    if (updated) return toOperationalView(updated);
    await this.requireRequest(requestId);
    throw new WorkflowConflictException();
  }

  private async requireRequest(requestId: string) {
    const request = await this.requests.findById(requestId);
    if (!request) throw new NotFoundException();
    return request;
  }
}
