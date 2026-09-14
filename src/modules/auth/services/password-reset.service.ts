import { Inject, Injectable } from "@nestjs/common";
import { appConfig } from "../../../core/config/app.config";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { LoggerService } from "../../../core/logger/logger.service";
import { PasswordHasherService } from "../../../core/security/password/password-hasher.service";
import { EMAIL_PORT, type TransactionalEmailPort } from "../../../infrastructure/email/email.port";
import { AuditLogsRepository } from "../repositories/audit-logs.repository";
import { SessionsRepository } from "../repositories/sessions.repository";
import { UsersRepository } from "../repositories/users.repository";
import { TokenLifecycleService } from "./token-lifecycle.service";

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly sessionsRepository: SessionsRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly transactionManager: TransactionManager,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenLifecycle: TokenLifecycleService,
    private readonly logger: LoggerService,
    @Inject(EMAIL_PORT) private readonly emailPort: TransactionalEmailPort,
  ) {}

  /** Always resolves without revealing whether the account exists. */
  async requestReset(email: string) {
    const user = await this.usersRepository.findByEmailNormalized(email.toLowerCase());
    if (!user) return;

    const rawToken = await this.tokenLifecycle.issue(user.id, "PASSWORD_RESET");
    const resetUrl = `${appConfig.appWebUrl}/reset-password?token=${rawToken}`;

    try {
      await this.emailPort.sendPasswordReset({ to: user.email, name: user.name, resetUrl });
    } catch (error) {
      this.logger.error("Failed to send password reset email", {
        err: error instanceof Error ? error : undefined,
      });
    }
  }

  async confirmReset(rawToken: string, newPassword: string) {
    const newPasswordHash = await this.passwordHasher.hash(newPassword);

    await this.transactionManager.runInTransaction(async () => {
      await this.tokenLifecycle.consume(rawToken, "PASSWORD_RESET", async (userId) => {
        await this.usersRepository.updatePasswordAndBumpAuthVersion(userId, newPasswordHash);
        await this.sessionsRepository.revokeAllActiveForUser(userId);
        await this.auditLogsRepository.record({
          actorUserId: userId,
          action: "auth.password.reset",
          entityType: "users",
          entityId: userId,
          userId,
          metadata: {},
        });
      });
    });
  }
}
