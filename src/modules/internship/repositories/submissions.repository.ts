import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  type NewSubmission,
  submissions,
  taskAssignments,
} from "../../../infrastructure/database/schema";

type SubmissionStatusValue = NewSubmission["status"];

@Injectable()
export class SubmissionsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    return row ?? null;
  }

  async findByTaskAssignmentId(taskAssignmentId: string) {
    const [row] = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.taskAssignmentId, taskAssignmentId))
      .limit(1);
    return row ?? null;
  }

  async findOwnList(userId: string, cursor: string | undefined, limit: number) {
    const conditions = [eq(submissions.userId, userId)];
    if (cursor) conditions.push(sql`${submissions.id} > ${cursor}`);
    return this.db
      .select()
      .from(submissions)
      .where(and(...conditions))
      .orderBy(desc(submissions.submittedAt))
      .limit(limit);
  }

  /**
   * Mentor/Admin review queue. For a Mentor (`reviewerId` supplied), this
   * includes both submissions already claimed by them AND unclaimed ones
   * (`reviewer_id IS NULL`) — otherwise no mentor could ever discover work
   * to claim via `start-review`. Admin (`reviewerId` undefined) sees every
   * submission.
   */
  async findReviewList(
    reviewerId: string | undefined,
    status: string | undefined,
    internshipTaskIds: readonly string[] | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    const conditions = [];
    if (reviewerId) {
      conditions.push(
        sql`(${submissions.reviewerId} = ${reviewerId} OR ${submissions.reviewerId} IS NULL)`,
      );
    }
    if (status) conditions.push(eq(submissions.status, status as SubmissionStatusValue));
    if (internshipTaskIds && internshipTaskIds.length > 0) {
      conditions.push(inArray(submissions.taskId, internshipTaskIds as string[]));
    }
    if (cursor) conditions.push(sql`${submissions.id} > ${cursor}`);

    return this.db
      .select()
      .from(submissions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(submissions.submittedAt))
      .limit(limit);
  }

  /** Distinct mentor/admin user ids who have reviewed any submission under this enrollment. */
  async findDistinctReviewersForEnrollment(enrollmentId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ reviewerId: submissions.reviewerId })
      .from(submissions)
      .innerJoin(taskAssignments, eq(taskAssignments.id, submissions.taskAssignmentId))
      .where(
        and(
          eq(taskAssignments.enrollmentId, enrollmentId),
          sql`${submissions.reviewerId} is not null`,
        ),
      );
    return rows.map((row) => row.reviewerId).filter((id): id is string => Boolean(id));
  }

  async create(input: NewSubmission) {
    const [row] = await this.db.insert(submissions).values(input).returning();
    return row;
  }

  /**
   * Atomic CAS transition + extra column writes in one UPDATE.
   * `allowedFromStates`/`toState` always come from the caller's lookup into
   * the Wave 0D-6 workflow registry (`getWorkflowDefinition("Submission")`)
   * — never hardcoded here.
   */
  async transitionWithExtras(
    id: string,
    allowedFromStates: readonly string[],
    toState: string,
    expectedStateVersion: number,
    extra: Partial<NewSubmission>,
  ) {
    const [row] = await this.db
      .update(submissions)
      .set({
        ...extra,
        status: toState as SubmissionStatusValue,
        stateVersion: sql`${submissions.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(submissions.id, id),
          inArray(submissions.status, allowedFromStates as SubmissionStatusValue[]),
          eq(submissions.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }
}
