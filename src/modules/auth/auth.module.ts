import { Module } from "@nestjs/common";
import { CsrfGuard } from "../../core/security/csrf/csrf.guard";
import { CsrfService } from "../../core/security/csrf/csrf.service";
import { AuthGuard } from "../../core/security/guards/auth.guard";
import { PasswordHasherService } from "../../core/security/password/password-hasher.service";
import { OpaqueSecretService } from "../../core/security/token/opaque-secret.service";
import { AuthController } from "./controllers/auth.controller";
import { AuditLogsRepository } from "./repositories/audit-logs.repository";
import { AuthTokensRepository } from "./repositories/auth-tokens.repository";
import { EmployersRepository } from "./repositories/employers.repository";
import { SessionsRepository } from "./repositories/sessions.repository";
import { UsersRepository } from "./repositories/users.repository";
import { EmailVerificationService } from "./services/email-verification.service";
import { PasswordResetService } from "./services/password-reset.service";
import { RegistrationService } from "./services/registration.service";
import { SessionService } from "./services/session.service";
import { SessionViewBuilder } from "./services/session-view.builder";
import { TokenLifecycleService } from "./services/token-lifecycle.service";

@Module({
  controllers: [AuthController],
  providers: [
    UsersRepository,
    EmployersRepository,
    SessionsRepository,
    AuthTokensRepository,
    AuditLogsRepository,
    PasswordHasherService,
    OpaqueSecretService,
    CsrfService,
    CsrfGuard,
    AuthGuard,
    TokenLifecycleService,
    RegistrationService,
    EmailVerificationService,
    SessionService,
    PasswordResetService,
    SessionViewBuilder,
  ],
  exports: [SessionService],
})
export class AuthModule {}
