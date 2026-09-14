import { Injectable } from "@nestjs/common";
import { appConfig } from "../../../core/config/app.config";
import { OpaqueSecretService } from "../../../core/security/token/opaque-secret.service";
import { AuthTokensRepository } from "../repositories/auth-tokens.repository";

type TokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

@Injectable()
export class TokenLifecycleService {
  constructor(
    private readonly authTokensRepository: AuthTokensRepository,
    private readonly opaqueSecretService: OpaqueSecretService,
  ) {}

  async issue(userId: string, purpose: TokenPurpose) {
    const { raw, hash } = this.opaqueSecretService.generate();
    const ttlMinutes =
      purpose === "EMAIL_VERIFICATION"
        ? appConfig.auth.emailVerificationTokenTtlMinutes
        : appConfig.auth.passwordResetTokenTtlMinutes;

    await this.authTokensRepository.create({
      userId,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    return raw;
  }

  /**
   * Validates a raw token against the given purpose and consumes it atomically
   * with the caller-supplied side effect (e.g. marking a user verified, or
   * updating a password), so a token cannot be used twice even under
   * concurrent requests racing on the same row.
   */
  async consume<TResult>(
    rawToken: string,
    purpose: TokenPurpose,
    onValid: (userId: string) => Promise<TResult>,
  ): Promise<TResult> {
    const hash = this.opaqueSecretService.hash(rawToken);
    const record = await this.authTokensRepository.findByHash(hash);

    if (!record || record.purpose !== purpose) {
      throw new InvalidTokenError();
    }
    if (record.consumedAt) {
      throw new InvalidTokenError();
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new InvalidTokenError();
    }

    const result = await onValid(record.userId);
    await this.authTokensRepository.consume(record.id);
    return result;
  }
}

export class InvalidTokenError extends Error {
  constructor() {
    super("Token is invalid, expired or already used");
  }
}
