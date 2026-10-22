import { Injectable } from "@nestjs/common";
import {
  buildPreciseCursorPage,
  PRECISE_CURSOR_KINDS,
} from "../../../common/pagination/precise-timestamp-cursor";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  DomainValidationException,
  NotFoundException,
  PermissionDeniedException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import { RequestContextService } from "../../../core/request-context/request-context.service";
import { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  toAdminEmployerView,
  toAdminUserView,
  toEmployerMemberView,
} from "../admin-accounts.views";
import type {
  EmployerProfileInput,
  EmployerStatusInput,
  RoleAssignmentInput,
} from "../dto/admin-accounts-mutation.dto";
import type { AdminEmployerListQuery, AdminUserListQuery } from "../dto/admin-accounts-query.dto";
import { AdminAccountsRepository } from "../repositories/admin-accounts.repository";

export const ROLE_CHANGE_MESSAGES = {
  self: "Admins cannot change their own role.",
  actorNotAdmin: "Your Admin role is no longer current.",
  assignBusiness: "ROLE_BUSINESS cannot be assigned through the Admin role change.",
  removeBusiness: "A Business account's role cannot be changed through the Admin role change.",
  lastAdmin: "The platform must keep at least one Admin.",
} as const;

/**
 * D7 governance decision for one role change, evaluated against the locked
 * Admin set. Returns the rejection to raise, or null when the change may
 * proceed. Pure so the rules are unit-testable independently of the DB.
 */
export function evaluateRoleChange(input: {
  actorUserId: string;
  targetUserId: string;
  currentRole: string;
  requestedRole: string;
  lockedAdminIds: readonly string[];
}): "actorNotAdmin" | "assignBusiness" | "removeBusiness" | "lastAdmin" | null {
  if (!input.lockedAdminIds.includes(input.actorUserId)) return "actorNotAdmin";
  if (input.requestedRole === "ROLE_BUSINESS") return "assignBusiness";
  if (input.currentRole === "ROLE_BUSINESS") return "removeBusiness";
  if (input.currentRole === "ROLE_ADMIN" && input.requestedRole !== "ROLE_ADMIN") {
    const remaining = input.lockedAdminIds.filter((id) => id !== input.targetUserId);
    if (remaining.length < 1) return "lastAdmin";
  }
  return null;
}

/**
 * UC-ADM-001 (API-ADM-001/002/003/004/005/006/007). Reads are Wave 7A;
 * the three mutations are Wave 7B under the USER-approved D7/D8 decisions.
 * Employer status is an administrative record only (D8): nothing here
 * touches sessions, logins, tenant membership or Business authorization.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly accounts: AdminAccountsRepository,
    private readonly transactions: TransactionManager,
    private readonly audits: AuditLogsRepository,
    private readonly context: RequestContextService,
  ) {}

  async listUsers(query: AdminUserListQuery) {
    const page = buildPreciseCursorPage(
      await this.accounts.listUsers(query),
      query.limit,
      PRECISE_CURSOR_KINDS.adminUsers,
    );
    return { data: page.data.map(toAdminUserView), meta: page.meta };
  }

  async getUser(id: string) {
    const row = await this.accounts.findUser(id);
    if (!row) throw new NotFoundException();
    return toAdminUserView(row);
  }

  async listEmployers(query: AdminEmployerListQuery) {
    const page = buildPreciseCursorPage(
      await this.accounts.listEmployers(query),
      query.limit,
      PRECISE_CURSOR_KINDS.adminEmployers,
    );
    return { data: page.data.map(toAdminEmployerView), meta: page.meta };
  }

  async getEmployer(id: string) {
    const row = await this.accounts.findEmployer(id);
    if (!row) throw new NotFoundException();
    return this.employerDetail(row);
  }

  /**
   * API-ADM-003. Self changes are refused before any lock is taken. Inside
   * one transaction the Admin set is locked (id order), then the target; the
   * actor must still be an Admin, D7 rules are applied, and the role update,
   * authVersion increment and audit row commit together. A same-role request
   * is a 200 no-op: no authVersion change and no audit event.
   */
  async changeRole(userId: string, principal: AuthPrincipal, input: RoleAssignmentInput) {
    if (userId === principal.userId) throw new PermissionDeniedException(ROLE_CHANGE_MESSAGES.self);
    return this.transactions.runInTransaction(async () => {
      const lockedAdminIds = await this.accounts.lockAdminIds();
      const target = await this.accounts.lockUser(userId);
      if (!target) throw new NotFoundException();
      if (target.role === input.role) {
        if (!lockedAdminIds.includes(principal.userId)) {
          throw new PermissionDeniedException(ROLE_CHANGE_MESSAGES.actorNotAdmin);
        }
        return toAdminUserView(target);
      }
      const rejection = evaluateRoleChange({
        actorUserId: principal.userId,
        targetUserId: target.id,
        currentRole: target.role,
        requestedRole: input.role,
        lockedAdminIds,
      });
      if (rejection === "actorNotAdmin") {
        throw new PermissionDeniedException(ROLE_CHANGE_MESSAGES.actorNotAdmin);
      }
      if (rejection === "assignBusiness") {
        throw new DomainValidationException(ROLE_CHANGE_MESSAGES.assignBusiness);
      }
      if (rejection) throw new WorkflowConflictException(ROLE_CHANGE_MESSAGES[rejection]);

      const updated = await this.accounts.changeRoleAndBumpAuthVersion(target.id, input.role);
      await this.audits.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "admin.user.role_changed",
        entityType: "users",
        entityId: target.id,
        userId: target.id,
        employerId: target.employerId ?? undefined,
        requestId: this.context.getRequestId(),
        metadata: { apiId: "API-ADM-003", oldRole: target.role, newRole: input.role },
      });
      return toAdminUserView(updated);
    });
  }

  /**
   * API-ADM-006. Only companyName/email are written, and only when they
   * differ; unchanged requests are a 200 no-op without an audit event. The
   * audit records changed field names, never values.
   */
  async updateEmployerProfile(
    employerId: string,
    principal: AuthPrincipal,
    input: EmployerProfileInput,
  ) {
    return this.transactions.runInTransaction(async () => {
      const current = await this.accounts.lockEmployer(employerId);
      if (!current) throw new NotFoundException();
      const changes: { companyName?: string; email?: string } = {};
      if (input.companyName !== undefined && input.companyName !== current.companyName) {
        changes.companyName = input.companyName;
      }
      if (input.email !== undefined && input.email !== current.email) changes.email = input.email;
      const changedFields = Object.keys(changes);
      if (changedFields.length === 0) return this.employerDetail(current);

      const updated = await this.accounts.updateEmployerProfile(employerId, changes);
      await this.audits.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "admin.employer.profile_updated",
        entityType: "employers",
        entityId: employerId,
        employerId,
        requestId: this.context.getRequestId(),
        metadata: { apiId: "API-ADM-006", changedFields },
      });
      return this.employerDetail(updated);
    });
  }

  /**
   * API-ADM-007. D8: an administrative record only — no session, login,
   * permission or tenant effect. Same-status requests are a 200 no-op.
   */
  async updateEmployerStatus(
    employerId: string,
    principal: AuthPrincipal,
    input: EmployerStatusInput,
  ) {
    return this.transactions.runInTransaction(async () => {
      const current = await this.accounts.lockEmployer(employerId);
      if (!current) throw new NotFoundException();
      if (current.status === input.status) return this.employerDetail(current);

      const updated = await this.accounts.updateEmployerStatus(employerId, input.status);
      await this.audits.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "admin.employer.status_changed",
        entityType: "employers",
        entityId: employerId,
        employerId,
        requestId: this.context.getRequestId(),
        metadata: { apiId: "API-ADM-007", from: current.status, to: input.status },
      });
      return this.employerDetail(updated);
    });
  }

  private async employerDetail(row: Parameters<typeof toAdminEmployerView>[0]) {
    const members = await this.accounts.findEmployerMembers(row.id);
    return { ...toAdminEmployerView(row), users: members.map(toEmployerMemberView) };
  }
}
