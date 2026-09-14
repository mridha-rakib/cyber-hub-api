import { Injectable } from "@nestjs/common";
import { appConfig } from "../../core/config/app.config";
import { LoggerService } from "../../core/logger/logger.service";
import type {
  SendEmailVerificationInput,
  SendPasswordResetInput,
  TransactionalEmailPort,
} from "./email.port";

const RESEND_API_URL = "https://api.resend.com/emails";

@Injectable()
export class ResendEmailAdapter implements TransactionalEmailPort {
  constructor(private readonly logger: LoggerService) {}

  async sendEmailVerification({ to, name, verificationUrl }: SendEmailVerificationInput) {
    await this.send({
      to,
      subject: "Verify your Cyber Security Hub account",
      html: `<p>Hi ${name},</p><p>Confirm your email address to activate your account:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
    });
  }

  async sendPasswordReset({ to, name, resetUrl }: SendPasswordResetInput) {
    await this.send({
      to,
      subject: "Reset your Cyber Security Hub password",
      html: `<p>Hi ${name},</p><p>Use the link below to reset your password. If you did not request this, you can ignore this email.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  private async send(message: { to: string; subject: string; html: string }) {
    if (!appConfig.email.resendApiKey) {
      this.logger.error("Resend email adapter invoked without a configured API key", {
        to: message.to,
      });
      throw new Error("Email provider is not configured: RESEND_API_KEY is missing");
    }

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appConfig.email.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: appConfig.email.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
      }),
    });

    if (!response.ok) {
      this.logger.error("Resend transactional email request failed", {
        to: message.to,
        statusCode: response.status,
      });
      throw new Error(`Resend request failed with status ${response.status}`);
    }
  }
}
