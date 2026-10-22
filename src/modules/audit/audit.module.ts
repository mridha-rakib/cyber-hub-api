import { Module } from "@nestjs/common";
import { AuditLogsController } from "./controllers/audit-logs.controller";
import { AuditLogReadRepository } from "./repositories/audit-log-read.repository";
import { AuditLogService } from "./services/audit-log.service";

/**
 * Wave 7A UC-ADM-004 Admin audit log reads. Audit writes (UC-SYS-003) stay
 * in AuditLogsRepository / AuthorizationAuditService; this module never
 * writes audit_logs.
 */
@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogReadRepository, AuditLogService],
})
export class AuditModule {}
