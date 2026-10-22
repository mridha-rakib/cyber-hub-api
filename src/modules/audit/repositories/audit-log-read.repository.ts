import { Injectable } from "@nestjs/common";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import {
  type DecodedPreciseCursor,
  preciseContinuation,
  preciseTimestampText,
} from "../../../common/pagination/precise-timestamp-cursor";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { auditLogs } from "../../../infrastructure/database/schema";

export interface AuditLogReadFilter {
  readonly actorUserId?: string;
  readonly action?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly employerId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: DecodedPreciseCursor;
  readonly limit: number;
}

/**
 * Read-only access to audit_logs (Wave 7A). Writes stay exclusively in
 * AuditLogsRepository; this class exposes no insert/update/delete.
 * Ordering uses the existing audit_logs_timestamp_idx (timestamp DESC).
 */
@Injectable()
export class AuditLogReadRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async list(filter: AuditLogReadFilter) {
    const conditions: SQL[] = [];
    if (filter.actorUserId) conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
    if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
    if (filter.entityType) conditions.push(eq(auditLogs.entityType, filter.entityType));
    if (filter.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
    if (filter.employerId) conditions.push(eq(auditLogs.employerId, filter.employerId));
    // The validated ISO string is cast by PostgreSQL, not via JS Date, so
    // sub-millisecond bounds are honoured exactly.
    if (filter.from) conditions.push(sql`${auditLogs.timestamp} >= ${filter.from}::timestamptz`);
    if (filter.to) conditions.push(sql`${auditLogs.timestamp} <= ${filter.to}::timestamptz`);
    if (filter.cursor) {
      conditions.push(preciseContinuation(auditLogs.timestamp, auditLogs.id, filter.cursor));
    }
    return this.db
      .select({ row: auditLogs, cursorSortValue: preciseTimestampText(auditLogs.timestamp) })
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
      .limit(filter.limit + 1);
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
    return row ?? null;
  }
}
