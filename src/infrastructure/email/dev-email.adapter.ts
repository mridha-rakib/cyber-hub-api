import { Injectable } from "@nestjs/common";
import { appConfig } from "../../core/config/app.config";
import { LoggerService } from "../../core/logger/logger.service";
import type {
  SendEmailVerificationInput,
  SendPasswordResetInput,
  TransactionalEmailPort,
} from "./email.port";

/**
 * DEV-ONLY adapter. Never selected when EMAIL_PROVIDER=resend, and refuses to run
 * in production regardless of configuration, so a misconfigured deployment cannot
 * silently "succeed" without ever delivering real email.
 */
@Injectable()
export class DevEmailAdapter implements TransactionalEmailPort {
  constructor(private readonly logger: LoggerService) {
    if (appConfig.isProduction) {
      throw new Error("DevEmailAdapter must not be used in production");
    }
  }

  async sendEmailVerification({ to, verificationUrl }: SendEmailVerificationInput) {
    this.logger.warn("[dev-email] email verification link (not sent via a real provider)", {
      to,
      verificationUrl,
    });
  }

  async sendPasswordReset({ to, resetUrl }: SendPasswordResetInput) {
    this.logger.warn("[dev-email] password reset link (not sent via a real provider)", {
      to,
      resetUrl,
    });
  }
}
