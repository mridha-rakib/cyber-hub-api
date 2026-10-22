import { Controller, Get, Param, Query } from "@nestjs/common";
import { ValidateUuidRouteParams } from "../../../common/decorators/validate-uuid-route-params.decorator";
import { AuthorizeOperation } from "../../../core/security/authorization/authorize-operation.decorator";
import { ValidationPipe } from "../../../core/validation/validation.pipe";
import { type AuditLogListQuery, auditLogListQuerySchema } from "../dto/audit-log-query.dto";
import { AuditLogService } from "../services/audit-log.service";

/** Wave 7A: ROLE_ADMIN audit.read — GET only (API-AUD-001/002). */
@Controller()
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @AuthorizeOperation("API-AUD-001")
  @Get("admin/audit-logs")
  list(@Query(new ValidationPipe(auditLogListQuerySchema)) query: AuditLogListQuery) {
    return this.auditLogs.list(query);
  }

  @AuthorizeOperation("API-AUD-002")
  @ValidateUuidRouteParams("auditLogId")
  @Get("admin/audit-logs/:auditLogId")
  get(@Param("auditLogId") auditLogId: string) {
    return this.auditLogs.get(auditLogId);
  }
}
