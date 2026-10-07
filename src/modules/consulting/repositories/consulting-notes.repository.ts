import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { consultingNotes } from "../../../infrastructure/database/schema";

@Injectable()
export class ConsultingNotesRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async create(consultingRequestId: string, authorUserId: string, body: string) {
    const [row] = await this.db
      .insert(consultingNotes)
      .values({ consultingRequestId, authorUserId, body })
      .returning();
    return row;
  }

  async listByRequest(consultingRequestId: string) {
    return this.db
      .select()
      .from(consultingNotes)
      .where(eq(consultingNotes.consultingRequestId, consultingRequestId))
      .orderBy(desc(consultingNotes.createdAt), desc(consultingNotes.id));
  }
}
