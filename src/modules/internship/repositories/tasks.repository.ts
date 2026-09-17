import { Injectable } from "@nestjs/common";
import { and, count, eq, inArray } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  type NewTask,
  submissions,
  taskAssignments,
  tasks,
} from "../../../infrastructure/database/schema";

@Injectable()
export class TasksRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return row ?? null;
  }

  async findByIds(ids: readonly string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tasks)
      .where(inArray(tasks.id, ids as string[]));
  }

  async findByInternship(internshipId: string) {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.internshipId, internshipId))
      .orderBy(tasks.orderNo);
  }

  async create(input: NewTask) {
    const [row] = await this.db.insert(tasks).values(input).returning();
    return row;
  }

  async update(id: string, patch: Partial<NewTask>) {
    const [row] = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return row ?? null;
  }

  /** True if this task has ever been assigned or has any submission history. */
  async hasAssignmentOrSubmissionHistory(id: string): Promise<boolean> {
    const [assignmentCount] = await this.db
      .select({ value: count() })
      .from(taskAssignments)
      .where(eq(taskAssignments.taskId, id));
    if (Number(assignmentCount?.value ?? 0) > 0) return true;

    const [submissionCount] = await this.db
      .select({ value: count() })
      .from(submissions)
      .where(eq(submissions.taskId, id));
    return Number(submissionCount?.value ?? 0) > 0;
  }

  async delete(id: string) {
    await this.db.delete(tasks).where(and(eq(tasks.id, id)));
  }
}
