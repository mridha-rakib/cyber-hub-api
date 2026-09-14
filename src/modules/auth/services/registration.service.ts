import { Inject, Injectable } from "@nestjs/common";
import { appConfig } from "../../../core/config/app.config";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { UniqueConstraintConflictException } from "../../../core/errors/app.exception";
import { LoggerService } from "../../../core/logger/logger.service";
import { PasswordHasherService } from "../../../core/security/password/password-hasher.service";
import { EMAIL_PORT, type TransactionalEmailPort } from "../../../infrastructure/email/email.port";
import type { RegisterBusinessInput } from "../dto/register-business.dto";
import type { RegisterLearnerInput } from "../dto/register-learner.dto";
import { AuditLogsRepository } from "../repositories/audit-logs.repository";
import { EmployersRepository } from "../repositories/employers.repository";
import { UsersRepository } from "../repositories/users.repository";
import { TokenLifecycleService } from "./token-lifecycle.service";

@Injectable()
export class RegistrationService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly employersRepository: EmployersRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly transactionManager: TransactionManager,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenLifecycle: TokenLifecycleService,
    private readonly logger: LoggerService,
    @Inject(EMAIL_PORT) private readonly emailPort: TransactionalEmailPort,
  ) {}

  async registerLearner(input: RegisterLearnerInput) {
    const emailNormalized = input.email.toLowerCase();
    const passwordHash = await this.passwordHasher.hash(input.password);

    const { userId, verificationToken } = await this.transactionManager.runInTransaction(
      async () => {
        const existing = await this.usersRepository.findByEmailNormalized(emailNormalized);
        if (existing) throw new UniqueConstraintConflictException("Email is already registered");

        const user = await this.usersRepository.create({
          name: input.name,
          email: input.email,
          emailNormalized,
          passwordHash,
          role: "ROLE_LEARNER",
          profile: input.profile ?? {},
        });

        const verificationToken = await this.tokenLifecycle.issue(user.id, "EMAIL_VERIFICATION");

        await this.auditLogsRepository.record({
          actorUserId: user.id,
          action: "auth.learner.registered",
          entityType: "users",
          entityId: user.id,
          userId: user.id,
          metadata: {},
        });

        return { userId: user.id, verificationToken };
      },
    );

    await this.sendVerificationEmailSafely(input.email, input.name, verificationToken);

    return { accountId: userId, verificationRequired: true };
  }

  async registerBusiness(input: RegisterBusinessInput) {
    const emailNormalized = input.email.toLowerCase();
    const passwordHash = await this.passwordHasher.hash(input.password);

    const { userId, verificationToken } = await this.transactionManager.runInTransaction(
      async () => {
        const existing = await this.usersRepository.findByEmailNormalized(emailNormalized);
        if (existing) throw new UniqueConstraintConflictException("Email is already registered");

        const employer = await this.employersRepository.create({
          companyName: input.companyName,
          email: input.businessEmail,
          profile: input.businessProfile ?? {},
          status: "ACTIVE",
        });

        const user = await this.usersRepository.create({
          name: input.name,
          email: input.email,
          emailNormalized,
          passwordHash,
          role: "ROLE_BUSINESS",
          employerId: employer.id,
          profile: input.userProfile ?? {},
        });

        const verificationToken = await this.tokenLifecycle.issue(user.id, "EMAIL_VERIFICATION");

        await this.auditLogsRepository.record({
          actorUserId: user.id,
          action: "auth.business.registered",
          entityType: "users",
          entityId: user.id,
          userId: user.id,
          employerId: employer.id,
          metadata: {},
        });

        return { userId: user.id, verificationToken };
      },
    );

    await this.sendVerificationEmailSafely(input.email, input.name, verificationToken);

    return { accountId: userId, verificationRequired: true };
  }

  private async sendVerificationEmailSafely(email: string, name: string, rawToken: string) {
    const verificationUrl = `${appConfig.appWebUrl}/verify-email?token=${rawToken}`;
    try {
      await this.emailPort.sendEmailVerification({ to: email, name, verificationUrl });
    } catch (error) {
      // The account already exists; verification email delivery is best-effort
      // here and recoverable via the resend-verification endpoint, so a
      // provider outage must not fail an otherwise-successful registration.
      this.logger.error("Failed to send verification email", {
        err: error instanceof Error ? error : undefined,
      });
    }
  }
}
