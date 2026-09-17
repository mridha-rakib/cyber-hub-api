import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  type NewSubmissionVersion,
  submissionVersions,
} from "../../../infrastructure/database/schema";

@Injectable()
export class SubmissionVersionsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findBySubmission(submissionId: string) {
    return this.db
      .select()
      .from(submissionVersions)
      .where(eq(submissionVersions.submissionId, submissionId))
      .orderBy(desc(submissionVersions.versionNo));
  }

  async create(input: NewSubmissionVersion) {
    const [row] = await this.db.insert(submissionVersions).values(input).returning();
    return row;
  }
}
