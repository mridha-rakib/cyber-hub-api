import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { type NewUser, users } from "../../../infrastructure/database/schema";

@Injectable()
export class UsersRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findByEmailNormalized(emailNormalized: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  async create(input: NewUser) {
    const [row] = await this.db.insert(users).values(input).returning();
    return row;
  }

  async markVerified(id: string) {
    await this.db
      .update(users)
      .set({ verified: true, verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updatePasswordAndBumpAuthVersion(id: string, passwordHash: string) {
    const [row] = await this.db
      .update(users)
      .set({
        passwordHash,
        authVersion: sql`${users.authVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return row;
  }
}
