import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  internshipApplications,
  type NewInternshipApplication,
} from "../../../infrastructure/database/schema";

type ApplicationStatusValue = NewInternshipApplication["status"];

@Injectable()
export class InternshipApplicationsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(internshipApplications)
      .where(eq(internshipApplications.id, id))
      .limit(1);
    return row ?? null;
  }

  async findOwnList(
    userId: string,
    status: string | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    const conditions = [eq(internshipApplications.userId, userId)];
    if (status)
      conditions.push(eq(internshipApplications.status, status as ApplicationStatusValue));
    if (cursor) conditions.push(sql`${internshipApplications.id} > ${cursor}`);

    return this.db
      .select()
      .from(internshipApplications)
      .where(and(...conditions))
      .orderBy(desc(internshipApplications.submittedAt))
      .limit(limit);
  }

  async findAdminList(
    status: string | undefined,
    internshipId: string | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    const conditions = [];
    if (status)
      conditions.push(eq(internshipApplications.status, status as ApplicationStatusValue));
    if (internshipId) conditions.push(eq(internshipApplications.internshipId, internshipId));
    if (cursor) conditions.push(sql`${internshipApplications.id} > ${cursor}`);

    return this.db
      .select()
      .from(internshipApplications)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(internshipApplications.submittedAt))
      .limit(limit);
  }

  async create(input: NewInternshipApplication) {
    const [row] = await this.db.insert(internshipApplications).values(input).returning();
    return row;
  }

  /**
   * Atomic CAS transition + extra column writes in one UPDATE. `allowedFromStates`
   * and `toState` are always supplied by the caller from the Wave 0D-6
   * workflow registry (`getWorkflowDefinition("InternshipApplication")`),
   * never hardcoded here — this repository has no independent opinion about
   * which states/transitions are valid.
   */
  async transitionWithExtras(
    id: string,
    allowedFromStates: readonly string[],
    toState: string,
    expectedStateVersion: number,
    extra: Partial<NewInternshipApplication>,
  ) {
    const [row] = await this.db
      .update(internshipApplications)
      .set({
        ...extra,
        status: toState as ApplicationStatusValue,
        stateVersion: sql`${internshipApplications.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(internshipApplications.id, id),
          inArray(internshipApplications.status, allowedFromStates as ApplicationStatusValue[]),
          eq(internshipApplications.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }
}
