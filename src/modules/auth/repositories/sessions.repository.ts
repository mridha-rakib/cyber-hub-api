import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { type NewSession, sessions } from "../../../infrastructure/database/schema";

@Injectable()
export class SessionsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async create(input: NewSession) {
    const [row] = await this.db.insert(sessions).values(input).returning();
    return row;
  }

  async findByKeyHash(sessionKeyHash: string) {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionKeyHash, sessionKeyHash))
      .limit(1);
    return row ?? null;
  }

  async revoke(id: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
  }

  async revokeAllActiveForUser(userId: string) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async touchLastSeen(id: string) {
    await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
}
