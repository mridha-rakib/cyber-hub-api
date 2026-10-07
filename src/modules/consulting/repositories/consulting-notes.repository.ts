import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { consultingNotes } from "../../../infrastructure/database/schema";
import type { DecodedConsultingCursor } from "../pagination/consulting-pagination";

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

  async listByRequest(
    consultingRequestId: string,
    filter: { cursor?: DecodedConsultingCursor; limit: number } = { limit: 100 },
  ) {
    const conditions = [eq(consultingNotes.consultingRequestId, consultingRequestId)];
    if (filter.cursor) {
      const continuation = or(
        lt(consultingNotes.createdAt, filter.cursor.sortValue),
        and(
          eq(consultingNotes.createdAt, filter.cursor.sortValue),
          lt(consultingNotes.id, filter.cursor.id),
        ),
      );
      if (continuation) conditions.push(continuation);
    }
    return this.db
      .select()
      .from(consultingNotes)
      .where(and(...conditions))
      .orderBy(desc(consultingNotes.createdAt), desc(consultingNotes.id))
      .limit(filter.limit + 1);
  }
}
