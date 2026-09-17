import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { type NewTaskAssignment, taskAssignments } from "../../../infrastructure/database/schema";

@Injectable()
export class TaskAssignmentsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(taskAssignments)
      .where(eq(taskAssignments.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByEnrollment(enrollmentId: string) {
    return this.db
      .select()
      .from(taskAssignments)
      .where(eq(taskAssignments.enrollmentId, enrollmentId))
      .orderBy(taskAssignments.assignedAt);
  }

  async findByEnrollmentAndTask(enrollmentId: string, taskId: string) {
    const rows = await this.db
      .select()
      .from(taskAssignments)
      .where(eq(taskAssignments.enrollmentId, enrollmentId));
    return rows.find((row) => row.taskId === taskId) ?? null;
  }

  /** Ignores tasks already assigned to this enrollment (idempotent, per the documented "duplicate assignments rejected/idempotently ignored" rule). */
  async createMany(inputs: readonly NewTaskAssignment[]) {
    if (inputs.length === 0) return [];
    return this.db
      .insert(taskAssignments)
      .values(inputs as NewTaskAssignment[])
      .onConflictDoNothing()
      .returning();
  }
}
