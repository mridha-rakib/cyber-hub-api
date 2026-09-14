export const EMAIL_PORT = Symbol("EMAIL_PORT");

export interface SendEmailVerificationInput {
  to: string;
  name: string;
  verificationUrl: string;
}

export interface SendPasswordResetInput {
  to: string;
  name: string;
  resetUrl: string;
}

export interface TransactionalEmailPort {
  sendEmailVerification(input: SendEmailVerificationInput): Promise<void>;
  sendPasswordReset(input: SendPasswordResetInput): Promise<void>;
}
