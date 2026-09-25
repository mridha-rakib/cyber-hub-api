import { Injectable } from "@nestjs/common";
import { and, arrayContains, desc, eq, inArray, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { jobs, type NewJob } from "../../../infrastructure/database/schema";

type JobStatusValue = NewJob["status"];

export interface PublicJobListFilter {
  readonly type?: string;
  readonly location?: string;
  readonly level?: string;
  readonly skill?: string;
  readonly remoteUk?: boolean;
  readonly cursor?: string;
  readonly limit: number;
}

export interface OwnJobListFilter {
  readonly status?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export interface AdminJobListFilter {
  readonly status?: string;
  readonly employerId?: string;
  readonly type?: string;
  readonly cursor?: string;
  readonly limit: number;
}

@Injectable()
export class JobsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return row ?? null;
  }

  /** API-CAR-001. PUBLISHED only, never widened by caller-supplied status. */
  async findPublishedList(filter: PublicJobListFilter) {
    const conditions = [eq(jobs.status, "PUBLISHED")];
    if (filter.type) conditions.push(eq(jobs.listingType, filter.type as NewJob["listingType"]));
    if (filter.location) conditions.push(eq(jobs.location, filter.location));
    if (filter.level) conditions.push(eq(jobs.level, filter.level));
    if (filter.skill) conditions.push(arrayContains(jobs.skills, [filter.skill]));
    if (filter.remoteUk !== undefined) conditions.push(eq(jobs.remoteUk, filter.remoteUk));
    if (filter.cursor) conditions.push(sql`${jobs.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.publishedAt))
      .limit(filter.limit);
  }

  /** API-BIZCAR-002. Every lifecycle state, scoped to one employer's own ORG. */
  async findOwnList(employerId: string, filter: OwnJobListFilter) {
    const conditions = [eq(jobs.employerId, employerId)];
    if (filter.status) conditions.push(eq(jobs.status, filter.status as JobStatusValue));
    if (filter.cursor) conditions.push(sql`${jobs.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.createdAt))
      .limit(filter.limit);
  }

  /** API-MOD-001. Every lifecycle state, every employer. */
  async findAdminList(filter: AdminJobListFilter) {
    const conditions = [];
    if (filter.status) conditions.push(eq(jobs.status, filter.status as JobStatusValue));
    if (filter.employerId) conditions.push(eq(jobs.employerId, filter.employerId));
    if (filter.type) conditions.push(eq(jobs.listingType, filter.type as NewJob["listingType"]));
    if (filter.cursor) conditions.push(sql`${jobs.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(jobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(filter.limit);
  }

  async create(input: NewJob) {
    const [row] = await this.db.insert(jobs).values(input).returning();
    return row;
  }

  /**
   * EDIT_GUARD update (API-BIZCAR-004): content edits only while the row's
   * current status is one of `allowedStates` — per the corrected
   * `workflow-operation-map.ts` entry, REJECTED only — and only at the
   * exact expected `stateVersion`. Never changes `status` itself.
   */
  async updateWithGuard(
    id: string,
    allowedStates: readonly string[],
    expectedStateVersion: number,
    patch: Partial<NewJob>,
  ) {
    const [row] = await this.db
      .update(jobs)
      .set({ ...patch, stateVersion: sql`${jobs.stateVersion} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, id),
          inArray(jobs.status, allowedStates as JobStatusValue[]),
          eq(jobs.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Atomic CAS transition + extra column writes in one UPDATE.
   * `allowedFromStates`/`toState` always come from the caller's lookup into
   * the Wave 0D-6 workflow registry (`getWorkflowDefinition("CareerListing")`)
   * — never hardcoded here.
   */
  async transitionWithExtras(
    id: string,
    allowedFromStates: readonly string[],
    toState: string,
    expectedStateVersion: number,
    extra: Partial<NewJob>,
  ) {
    const [row] = await this.db
      .update(jobs)
      .set({
        ...extra,
        status: toState as JobStatusValue,
        stateVersion: sql`${jobs.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.id, id),
          inArray(jobs.status, allowedFromStates as JobStatusValue[]),
          eq(jobs.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }
}
