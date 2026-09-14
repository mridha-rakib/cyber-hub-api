import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { auditLogs, type NewAuditLog } from "../../../infrastructure/database/schema";

@Injectable()
export class AuditLogsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async record(entry: NewAuditLog) {
    await this.db.insert(auditLogs).values(entry);
  }
}
