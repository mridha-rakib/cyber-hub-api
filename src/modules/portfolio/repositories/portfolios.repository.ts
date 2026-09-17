import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { type NewPortfolio, portfolios } from "../../../infrastructure/database/schema";

@Injectable()
export class PortfoliosRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(portfolios).where(eq(portfolios.id, id)).limit(1);
    return row ?? null;
  }

  async findByUserId(userId: string) {
    const [row] = await this.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async findByPublicSlug(publicSlug: string) {
    const [row] = await this.db
      .select()
      .from(portfolios)
      .where(eq(portfolios.publicSlug, publicSlug))
      .limit(1);
    return row ?? null;
  }

  /**
   * No documented "create portfolio" endpoint exists — the ERD describes
   * "one portfolio root row per learner" as always conceptually present.
   * `getOrCreateForUser` materializes it lazily on first touch (get/create,
   * `UNIQUE(user_id)` makes a concurrent double-create a harmless no-op via
   * `onConflictDoNothing` + re-read), never on any other user's behalf.
   */
  async getOrCreateForUser(userId: string) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;

    await this.db.insert(portfolios).values({ userId }).onConflictDoNothing();
    const created = await this.findByUserId(userId);
    if (!created) throw new Error(`Failed to get-or-create portfolio for user ${userId}`);
    return created;
  }

  async updatePublication(id: string, patch: Partial<NewPortfolio>) {
    const [row] = await this.db
      .update(portfolios)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(portfolios.id, id))
      .returning();
    return row ?? null;
  }
}
