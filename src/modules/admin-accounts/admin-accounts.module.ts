import { Module } from "@nestjs/common";
import { CsrfGuard } from "../../core/security/csrf/csrf.guard";
import { CsrfService } from "../../core/security/csrf/csrf.service";
import { AuditLogsRepository } from "../auth/repositories/audit-logs.repository";
import { AdminAccountsController } from "./controllers/admin-accounts.controller";
import { AdminAccountsRepository } from "./repositories/admin-accounts.repository";
import { AdminAccountsService } from "./services/admin-accounts.service";

/**
 * UC-ADM-001: Wave 7A reads (API-ADM-001/002/004/005) and Wave 7B
 * mutations (API-ADM-003/006/007). CsrfService/CsrfGuard are stateless and
 * provided locally, as AuthModule does for the auth controller.
 */
@Module({
  controllers: [AdminAccountsController],
  providers: [
    AdminAccountsRepository,
    AdminAccountsService,
    AuditLogsRepository,
    CsrfService,
    CsrfGuard,
  ],
})
export class AdminAccountsModule {}
