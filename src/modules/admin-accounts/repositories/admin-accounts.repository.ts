import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import {
  type DecodedPreciseCursor,
  preciseContinuation,
  preciseTimestampText,
} from "../../../common/pagination/precise-timestamp-cursor";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { employers, users } from "../../../infrastructure/database/schema";
import { adminEmployerColumns, adminUserColumns } from "../admin-accounts.views";

export interface AdminUserFilter {
  readonly role?: (typeof users.role.enumValues)[number];
  readonly verified?: boolean;
  readonly cursor?: DecodedPreciseCursor;
  readonly limit: number;
}

export interface AdminEmployerFilter {
  readonly status?: (typeof employers.status.enumValues)[number];
  readonly cursor?: DecodedPreciseCursor;
  readonly limit: number;
}

/** Linked accounts shown on an employer detail are bounded, never unbounded. */
export const MAX_EMPLOYER_MEMBERS = 100;

/**
 * Admin account persistence. Wave 7A reads; Wave 7B adds only the three
 * approved mutations (role, employer profile, employer status). No insert or
 * delete is exposed.
 */
@Injectable()
export class AdminAccountsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async listUsers(filter: AdminUserFilter) {
    const conditions: SQL[] = [];
    if (filter.role) conditions.push(eq(users.role, filter.role));
    if (filter.verified !== undefined) conditions.push(eq(users.verified, filter.verified));
    if (filter.cursor)
      conditions.push(preciseContinuation(users.createdAt, users.id, filter.cursor));
    return this.db
      .select({ ...adminUserColumns, cursorSortValue: preciseTimestampText(users.createdAt) })
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(filter.limit + 1);
  }

  async findUser(id: string) {
    const [row] = await this.db
      .select(adminUserColumns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  async listEmployers(filter: AdminEmployerFilter) {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(employers.status, filter.status));
    if (filter.cursor) {
      conditions.push(preciseContinuation(employers.createdAt, employers.id, filter.cursor));
    }
    return this.db
      .select({
        ...adminEmployerColumns,
        cursorSortValue: preciseTimestampText(employers.createdAt),
      })
      .from(employers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(employers.createdAt), desc(employers.id))
      .limit(filter.limit + 1);
  }

  async findEmployer(id: string) {
    const [row] = await this.db
      .select(adminEmployerColumns)
      .from(employers)
      .where(eq(employers.id, id))
      .limit(1);
    return row ?? null;
  }

  async findEmployerMembers(employerId: string) {
    return this.db
      .select(adminUserColumns)
      .from(users)
      .where(eq(users.employerId, employerId))
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(MAX_EMPLOYER_MEMBERS);
  }

  // --- Wave 7B mutations: callers must run inside TransactionManager ---

  /**
   * Locks every current ROLE_ADMIN row in id order. Concurrent role changes
   * therefore serialize on the same lock order (no deadlock), and a waiting
   * transaction re-evaluates `role = ROLE_ADMIN` after the earlier one
   * commits, so it sees an Admin set that already reflects that change.
   */
  async lockAdminIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "ROLE_ADMIN"))
      .orderBy(asc(users.id))
      .for("update");
    return rows.map((row) => row.id);
  }

  async lockUser(id: string) {
    const [row] = await this.db
      .select(adminUserColumns)
      .from(users)
      .where(eq(users.id, id))
      .for("update")
      .limit(1);
    return row ?? null;
  }

  /**
   * Role change plus authVersion increment in one statement — the existing
   * session invalidation mechanism (SessionService.authenticate rejects any
   * session whose authVersion differs). employer_id is never written.
   */
  async changeRoleAndBumpAuthVersion(id: string, role: AdminUserFilter["role"] & string) {
    const [row] = await this.db
      .update(users)
      .set({ role, authVersion: sql`${users.authVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(adminUserColumns);
    return row;
  }

  async lockEmployer(id: string) {
    const [row] = await this.db
      .select(adminEmployerColumns)
      .from(employers)
      .where(eq(employers.id, id))
      .for("update")
      .limit(1);
    return row ?? null;
  }

  /** Writes only the supplied allow-listed columns; profile/status/id are untouched. */
  async updateEmployerProfile(id: string, changes: { companyName?: string; email?: string }) {
    const [row] = await this.db
      .update(employers)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(employers.id, id))
      .returning(adminEmployerColumns);
    return row;
  }

  async updateEmployerStatus(id: string, status: AdminEmployerFilter["status"] & string) {
    const [row] = await this.db
      .update(employers)
      .set({ status, updatedAt: new Date() })
      .where(eq(employers.id, id))
      .returning(adminEmployerColumns);
    return row;
  }
}
