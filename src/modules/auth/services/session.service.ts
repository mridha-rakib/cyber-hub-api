import { Injectable } from "@nestjs/common";
import { appConfig } from "../../../core/config/app.config";
import { InvalidCredentialsException } from "../../../core/errors/app.exception";
import { PasswordHasherService } from "../../../core/security/password/password-hasher.service";
import { OpaqueSecretService } from "../../../core/security/token/opaque-secret.service";
import { AuditLogsRepository } from "../repositories/audit-logs.repository";
import { SessionsRepository } from "../repositories/sessions.repository";
import { UsersRepository } from "../repositories/users.repository";
import type { AuthPrincipal } from "./session-authentication.types";

@Injectable()
export class SessionService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly sessionsRepository: SessionsRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly passwordHasher: PasswordHasherService,
    private readonly opaqueSecretService: OpaqueSecretService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersRepository.findByEmailNormalized(email.toLowerCase());
    if (!user || !(await this.passwordHasher.verify(user.passwordHash, password))) {
      throw new InvalidCredentialsException();
    }

    const { raw, hash } = this.opaqueSecretService.generate();
    const expiresAt = new Date(Date.now() + appConfig.auth.sessionTtlDays * 24 * 60 * 60_000);

    const session = await this.sessionsRepository.create({
      userId: user.id,
      sessionKeyHash: hash,
      authVersion: user.authVersion,
      expiresAt,
    });

    await this.auditLogsRepository.record({
      actorUserId: user.id,
      action: "auth.login.success",
      entityType: "sessions",
      entityId: session.id,
      userId: user.id,
      employerId: user.employerId ?? undefined,
      metadata: {},
    });

    return { rawSessionSecret: raw, user };
  }

  async authenticate(rawSessionSecret: string): Promise<AuthPrincipal | null> {
    const hash = this.opaqueSecretService.hash(rawSessionSecret);
    const session = await this.sessionsRepository.findByKeyHash(hash);
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;

    const user = await this.usersRepository.findById(session.userId);
    if (!user) return null;
    if (session.authVersion !== user.authVersion) return null;

    void this.sessionsRepository.touchLastSeen(session.id);

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return {
      sessionId: session.id,
      userId: user.id,
      role: user.role,
      employerId: user.employerId ?? undefined,
      user: safeUser,
    };
  }

  async logout(sessionId: string, userId: string) {
    await this.sessionsRepository.revoke(sessionId);
    await this.auditLogsRepository.record({
      actorUserId: userId,
      action: "auth.logout",
      entityType: "sessions",
      entityId: sessionId,
      userId,
      metadata: {},
    });
  }
}
