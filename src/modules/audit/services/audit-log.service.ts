import { Injectable } from "@nestjs/common";
import {
  buildPreciseCursorPage,
  PRECISE_CURSOR_KINDS,
} from "../../../common/pagination/precise-timestamp-cursor";
import { NotFoundException } from "../../../core/errors/app.exception";
import { toAuditLogView } from "../audit-log.views";
import type { AuditLogListQuery } from "../dto/audit-log-query.dto";
import { AuditLogReadRepository } from "../repositories/audit-log-read.repository";

/** UC-ADM-004 Admin audit log reads (API-AUD-001/002). Read-only. */
@Injectable()
export class AuditLogService {
  constructor(private readonly auditLogs: AuditLogReadRepository) {}

  async list(query: AuditLogListQuery) {
    const rows = await this.auditLogs.list(query);
    const page = buildPreciseCursorPage(
      rows.map(({ row, cursorSortValue }) => ({ ...row, cursorSortValue })),
      query.limit,
      PRECISE_CURSOR_KINDS.auditLogs,
    );
    return { data: page.data.map(toAuditLogView), meta: page.meta };
  }

  async get(id: string) {
    const row = await this.auditLogs.findById(id);
    if (!row) throw new NotFoundException();
    return toAuditLogView(row);
  }
}
