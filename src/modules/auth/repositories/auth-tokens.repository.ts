import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { authTokens, type NewAuthToken } from "../../../infrastructure/database/schema";

@Injectable()
export class AuthTokensRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async create(input: NewAuthToken) {
    const [row] = await this.db.insert(authTokens).values(input).returning();
    return row;
  }

  async findByHash(tokenHash: string) {
    const [row] = await this.db
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async consume(id: string) {
    await this.db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, id));
  }
}
