import { Inject, Injectable } from "@nestjs/common";
import { appConfig } from "../../../core/config/app.config";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { LoggerService } from "../../../core/logger/logger.service";
import { EMAIL_PORT, type TransactionalEmailPort } from "../../../infrastructure/email/email.port";
import { AuditLogsRepository } from "../repositories/audit-logs.repository";
import { UsersRepository } from "../repositories/users.repository";
import { InvalidTokenError, TokenLifecycleService } from "./token-lifecycle.service";

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly transactionManager: TransactionManager,
    private readonly tokenLifecycle: TokenLifecycleService,
    private readonly logger: LoggerService,
    @Inject(EMAIL_PORT) private readonly emailPort: TransactionalEmailPort,
  ) {}

  /** Always resolves without revealing whether the account exists. */
  async requestVerification(email: string) {
    const user = await this.usersRepository.findByEmailNormalized(email.toLowerCase());
    if (!user || user.verified) return;

    const rawToken = await this.tokenLifecycle.issue(user.id, "EMAIL_VERIFICATION");
    const verificationUrl = `${appConfig.appWebUrl}/verify-email?token=${rawToken}`;

    try {
      await this.emailPort.sendEmailVerification({
        to: user.email,
        name: user.name,
        verificationUrl,
      });
    } catch (error) {
      this.logger.error("Failed to send verification email", {
        err: error instanceof Error ? error : undefined,
      });
    }
  }

  async confirm(rawToken: string) {
    await this.transactionManager.runInTransaction(async () => {
      await this.tokenLifecycle.consume(rawToken, "EMAIL_VERIFICATION", async (userId) => {
        await this.usersRepository.markVerified(userId);
        await this.auditLogsRepository.record({
          actorUserId: userId,
          action: "auth.email.verified",
          entityType: "users",
          entityId: userId,
          userId,
          metadata: {},
        });
      });
    });
  }
}

export { InvalidTokenError };
