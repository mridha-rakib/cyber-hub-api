import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  NotFoundException,
  StateVersionConflictException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { RequestContextService } from "../../../core/request-context/request-context.service";
import type { ApiId } from "../../../core/security/authorization/api-authorization-map";
import { requireTransition } from "../../../core/workflow/workflow-helper";
import {
  WORKFLOW_OPERATION_MAP,
  type WorkflowOperationMapping,
} from "../../../core/workflow/workflow-operation-map";
import { WorkflowValidationService } from "../../../core/workflow/workflow-validation.service";
import { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import type {
  AdminResourceListQuery,
  PublicResourceListQuery,
  ResourceCreateInput,
  ResourceUpdateInput,
} from "../dto/resource.dto";
import { buildResourceCursorPage, RESOURCE_CURSOR_KINDS } from "../pagination/resource-cursor";
import { type ResourceFieldPatch, ResourcesRepository } from "../repositories/resources.repository";
import { type ResourceAdminRow, toResourceAdminView, toResourceView } from "../resource.views";

type ResourceStatus = ResourceAdminRow["status"];
type Kind = WorkflowOperationMapping["kind"];

const EDITABLE_FIELDS = ["title", "category", "tags", "content", "featured"] as const;

/** The operation's policy from the single authoritative map (G4-A); a missing/wrong kind is a wiring bug. */
function policy<K extends Kind>(apiId: ApiId, kind: K) {
  const mapping = WORKFLOW_OPERATION_MAP[apiId];
  if (mapping?.kind !== kind || mapping.entityType !== "Resource") {
    throw new Error(`${apiId} ${kind} workflow mapping missing`);
  }
  return mapping as Extract<WorkflowOperationMapping, { kind: K }>;
}

/**
 * Wave 7C Resource backend (API-RES-001/002, API-ADMRES-001..007; State &
 * Workflow v1.3 §5A.1/§5A.3; API Contract v1.6 W7C-1/W7C-2/W7C-9..W7C-12).
 *
 * Every mutation runs in one transaction: lock the row, then classify in the
 * documented order — missing 404, stale version 409 STATE_VERSION_CONFLICT
 * (details.currentStateVersion), disallowed state 409 STATE_CONFLICT — then
 * one conditional write and exactly one minimized `content.resource.*` audit
 * row. A failed audit write rolls the domain write back with it. Allowed
 * states and transitions come only from WORKFLOW_OPERATION_MAP / the
 * registry, never from request input.
 */
@Injectable()
export class ResourceService {
  constructor(
    private readonly resources: ResourcesRepository,
    private readonly audits: AuditLogsRepository,
    private readonly transactions: TransactionManager,
    private readonly workflow: WorkflowValidationService,
    private readonly context: RequestContextService,
  ) {}

  // --- public reads ---

  /** API-RES-001. PUBLISHED-only (in SQL); recent or featured keyset pagination. */
  async listPublished(query: PublicResourceListQuery) {
    const rows = await this.resources.listPublished(query);
    const page = buildResourceCursorPage(rows, query.limit, query.kind);
    return { data: page.data.map(toResourceView), meta: page.meta };
  }

  /** API-RES-002. A draft, archived or missing resource is the same 404. */
  async getPublished(id: string) {
    const row = await this.resources.findPublishedById(id);
    if (!row) throw new NotFoundException();
    return toResourceView(row);
  }

  // --- admin reads ---

  /** API-ADMRES-006. Every lifecycle state; createdAt desc, id desc. */
  async listAdmin(query: AdminResourceListQuery) {
    const rows = await this.resources.listAdmin(query);
    const page = buildResourceCursorPage(rows, query.limit, RESOURCE_CURSOR_KINDS.adminRecent);
    return { data: page.data.map(toResourceAdminView), meta: page.meta };
  }

  /** API-ADMRES-007. Any lifecycle state. */
  async getAdmin(id: string) {
    const row = await this.resources.findById(id);
    if (!row) throw new NotFoundException();
    return toResourceAdminView(row);
  }

  // --- admin mutations ---

  /** API-ADMRES-001: WF-RES-01 (new -> DRAFT), stateVersion 1. */
  async create(principal: AuthPrincipal, input: ResourceCreateInput) {
    const [transitionId] = policy("API-ADMRES-001", "TRANSITION").transitionIds;
    const result = this.workflow.validate("Resource", transitionId, null);
    if (!result.valid) throw new WorkflowConflictException();
    return this.transactions.runInTransaction(async () => {
      const row = await this.resources.insert({
        title: input.title,
        category: input.category,
        tags: input.tags,
        content: input.content,
        featured: input.featured ?? false,
        status: result.to as ResourceStatus,
      });
      await this.audit(principal, "content.resource.created", row.id, {
        apiId: "API-ADMRES-001",
        transitionId,
        to: row.status,
        stateVersion: row.stateVersion,
      });
      return toResourceAdminView(row);
    });
  }

  /** API-ADMRES-002: EDIT_GUARD — content fields in any allowed state, status unchanged. */
  async update(id: string, principal: AuthPrincipal, input: ResourceUpdateInput) {
    const { allowedStates } = policy("API-ADMRES-002", "EDIT_GUARD");
    const { expectedStateVersion, ...fields } = input;
    return this.transactions.runInTransaction(async () => {
      const current = await this.lockAndCheck(id, expectedStateVersion);
      if (!allowedStates.includes(current.status)) throw new WorkflowConflictException();

      const patch: ResourceFieldPatch = {};
      const changedFields: string[] = [];
      for (const key of EDITABLE_FIELDS) {
        if (fields[key] === undefined) continue;
        (patch as Record<string, unknown>)[key] = fields[key];
        if (JSON.stringify(fields[key]) !== JSON.stringify(current[key])) changedFields.push(key);
      }
      const row = await this.resources.updateFields(
        id,
        allowedStates as ResourceStatus[],
        expectedStateVersion,
        patch,
      );
      if (!row) return this.classifyFailure(id, expectedStateVersion);
      await this.audit(principal, "content.resource.updated", id, {
        apiId: "API-ADMRES-002",
        stateVersion: row.stateVersion,
        changedFields,
      });
      return toResourceAdminView(row);
    });
  }

  /** API-ADMRES-003: WF-RES-02 (DRAFT) or WF-RES-04 (ARCHIVED) -> PUBLISHED; publishedAt = now. */
  async publish(id: string, principal: AuthPrincipal, expectedStateVersion: number) {
    return this.transitionCommand("API-ADMRES-003", id, principal, expectedStateVersion, {
      action: "content.resource.published",
      setPublishedAtNow: true,
    });
  }

  /** API-ADMRES-004: WF-RES-03 PUBLISHED -> ARCHIVED; publishedAt retained. */
  async archive(id: string, principal: AuthPrincipal, expectedStateVersion: number) {
    return this.transitionCommand("API-ADMRES-004", id, principal, expectedStateVersion, {
      action: "content.resource.archived",
      setPublishedAtNow: false,
    });
  }

  /** API-ADMRES-005: DELETE_GUARD — DRAFT only, expected version, no increment; 204. */
  async delete(id: string, principal: AuthPrincipal, expectedStateVersion: number): Promise<void> {
    const { allowedStates } = policy("API-ADMRES-005", "DELETE_GUARD");
    await this.transactions.runInTransaction(async () => {
      const current = await this.lockAndCheck(id, expectedStateVersion);
      if (!allowedStates.includes(current.status)) throw new WorkflowConflictException();
      const deleted = await this.resources.deleteGuarded(
        id,
        allowedStates as ResourceStatus[],
        expectedStateVersion,
      );
      if (!deleted) return this.classifyFailure(id, expectedStateVersion);
      await this.audit(principal, "content.resource.deleted", id, {
        apiId: "API-ADMRES-005",
        from: deleted.status,
        stateVersion: deleted.stateVersion,
      });
    });
  }

  private async transitionCommand(
    apiId: ApiId,
    id: string,
    principal: AuthPrincipal,
    expectedStateVersion: number,
    options: { readonly action: string; readonly setPublishedAtNow: boolean },
  ) {
    const { transitionIds } = policy(apiId, "TRANSITION");
    return this.transactions.runInTransaction(async () => {
      const current = await this.lockAndCheck(id, expectedStateVersion);
      const transitionId = this.workflow.resolveCandidate(
        "Resource",
        transitionIds,
        current.status,
      );
      if (!transitionId) throw new WorkflowConflictException();
      const result = this.workflow.validate("Resource", transitionId, current.status);
      if (!result.valid) throw new WorkflowConflictException();
      const transition = requireTransition("Resource", transitionId);
      const row = await this.resources.transition(
        id,
        transition.from as ResourceStatus[],
        result.to as ResourceStatus,
        expectedStateVersion,
        { setPublishedAtNow: options.setPublishedAtNow },
      );
      if (!row) return this.classifyFailure(id, expectedStateVersion);
      await this.audit(principal, options.action, id, {
        apiId,
        transitionId,
        from: current.status,
        to: row.status,
        stateVersion: row.stateVersion,
      });
      return toResourceAdminView(row);
    });
  }

  /** Row lock, then 404 / 409 STATE_VERSION_CONFLICT in the documented order (W7C-12). */
  private async lockAndCheck(id: string, expectedStateVersion: number) {
    const current = await this.resources.lockById(id);
    if (!current) throw new NotFoundException();
    if (current.stateVersion !== expectedStateVersion) {
      throw new StateVersionConflictException(current.stateVersion);
    }
    return current;
  }

  /** Defensive: a conditional write found nothing despite the lock — classify from one fresh read. */
  private async classifyFailure(id: string, expectedStateVersion: number): Promise<never> {
    const current = await this.resources.findById(id);
    if (!current) throw new NotFoundException();
    if (current.stateVersion !== expectedStateVersion) {
      throw new StateVersionConflictException(current.stateVersion);
    }
    throw new WorkflowConflictException();
  }

  /** Minimized metadata only (allow-listed keys); never content, URLs or values. */
  private async audit(
    principal: AuthPrincipal,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audits.record({
      actorUserId: principal.userId,
      actorRole: principal.role,
      action,
      entityType: "resources",
      entityId: resourceId,
      metadata,
      requestId: this.context.getRequestId(),
    });
  }
}
