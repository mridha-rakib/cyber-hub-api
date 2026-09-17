import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  internshipEnrollments,
  type NewInternshipEnrollment,
} from "../../../infrastructure/database/schema";

@Injectable()
export class InternshipEnrollmentsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(internshipEnrollments)
      .where(eq(internshipEnrollments.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByApplicationId(applicationId: string) {
    const [row] = await this.db
      .select()
      .from(internshipEnrollments)
      .where(eq(internshipEnrollments.applicationId, applicationId))
      .limit(1);
    return row ?? null;
  }

  async findOwnList(userId: string, cursor: string | undefined, limit: number) {
    const conditions = [eq(internshipEnrollments.userId, userId)];
    if (cursor) conditions.push(sql`${internshipEnrollments.id} > ${cursor}`);

    return this.db
      .select()
      .from(internshipEnrollments)
      .where(and(...conditions))
      .orderBy(internshipEnrollments.id)
      .limit(limit);
  }

  async create(input: NewInternshipEnrollment) {
    const [row] = await this.db.insert(internshipEnrollments).values(input).returning();
    return row;
  }

  async updateEligibility(
    id: string,
    eligibility: "NOT_ELIGIBLE" | "ELIGIBLE",
    eligibleAt: Date | null,
  ) {
    const [row] = await this.db
      .update(internshipEnrollments)
      .set({
        completionEligibility: eligibility,
        eligibilityEvaluatedAt: new Date(),
        eligibleAt,
        updatedAt: new Date(),
      })
      .where(eq(internshipEnrollments.id, id))
      .returning();
    return row ?? null;
  }
}
