import { Injectable } from "@nestjs/common";
import { and, arrayContains, desc, eq, inArray, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  employerOpportunities,
  type NewEmployerOpportunity,
} from "../../../infrastructure/database/schema";

type OpportunityStatusValue = NewEmployerOpportunity["status"];

export interface PublicOpportunityListFilter {
  readonly type?: string;
  readonly skill?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export interface OwnOpportunityListFilter {
  readonly type?: string;
  readonly status?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export interface AdminOpportunityListFilter {
  readonly status?: string;
  readonly employerId?: string;
  readonly type?: string;
  readonly cursor?: string;
  readonly limit: number;
}

@Injectable()
export class EmployerOpportunitiesRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(employerOpportunities)
      .where(eq(employerOpportunities.id, id))
      .limit(1);
    return row ?? null;
  }

  /** API-EMP-001. PUBLISHED only, never widened by caller-supplied status. */
  async findPublishedList(filter: PublicOpportunityListFilter) {
    const conditions = [eq(employerOpportunities.status, "PUBLISHED")];
    if (filter.type)
      conditions.push(
        eq(employerOpportunities.type, filter.type as NewEmployerOpportunity["type"]),
      );
    if (filter.skill) conditions.push(arrayContains(employerOpportunities.skills, [filter.skill]));
    if (filter.cursor) conditions.push(sql`${employerOpportunities.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(employerOpportunities)
      .where(and(...conditions))
      .orderBy(desc(employerOpportunities.publishedAt))
      .limit(filter.limit);
  }

  /** API-BIZOPP-002. Every lifecycle state, scoped to one employer's own ORG. */
  async findOwnList(employerId: string, filter: OwnOpportunityListFilter) {
    const conditions = [eq(employerOpportunities.employerId, employerId)];
    if (filter.type)
      conditions.push(
        eq(employerOpportunities.type, filter.type as NewEmployerOpportunity["type"]),
      );
    if (filter.status)
      conditions.push(eq(employerOpportunities.status, filter.status as OpportunityStatusValue));
    if (filter.cursor) conditions.push(sql`${employerOpportunities.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(employerOpportunities)
      .where(and(...conditions))
      .orderBy(desc(employerOpportunities.createdAt))
      .limit(filter.limit);
  }

  /** API-MOD-002. Every lifecycle state, every employer. */
  async findAdminList(filter: AdminOpportunityListFilter) {
    const conditions = [];
    if (filter.status)
      conditions.push(eq(employerOpportunities.status, filter.status as OpportunityStatusValue));
    if (filter.employerId) conditions.push(eq(employerOpportunities.employerId, filter.employerId));
    if (filter.type)
      conditions.push(
        eq(employerOpportunities.type, filter.type as NewEmployerOpportunity["type"]),
      );
    if (filter.cursor) conditions.push(sql`${employerOpportunities.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(employerOpportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(employerOpportunities.createdAt))
      .limit(filter.limit);
  }

  async create(input: NewEmployerOpportunity) {
    const [row] = await this.db.insert(employerOpportunities).values(input).returning();
    return row;
  }

  /**
   * EDIT_GUARD update (API-BIZOPP-004): content edits only while the row's
   * current status is one of `allowedStates` — per the corrected
   * `workflow-operation-map.ts` entry, REJECTED only — and only at the
   * exact expected `stateVersion`. Never changes `status` itself.
   */
  async updateWithGuard(
    id: string,
    allowedStates: readonly string[],
    expectedStateVersion: number,
    patch: Partial<NewEmployerOpportunity>,
  ) {
    const [row] = await this.db
      .update(employerOpportunities)
      .set({
        ...patch,
        stateVersion: sql`${employerOpportunities.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(employerOpportunities.id, id),
          inArray(employerOpportunities.status, allowedStates as OpportunityStatusValue[]),
          eq(employerOpportunities.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Atomic CAS transition + extra column writes in one UPDATE.
   * `allowedFromStates`/`toState` always come from the caller's lookup into
   * the Wave 0D-6 workflow registry
   * (`getWorkflowDefinition("EmployerOpportunity")`) — never hardcoded here.
   */
  async transitionWithExtras(
    id: string,
    allowedFromStates: readonly string[],
    toState: string,
    expectedStateVersion: number,
    extra: Partial<NewEmployerOpportunity>,
  ) {
    const [row] = await this.db
      .update(employerOpportunities)
      .set({
        ...extra,
        status: toState as OpportunityStatusValue,
        stateVersion: sql`${employerOpportunities.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(employerOpportunities.id, id),
          inArray(employerOpportunities.status, allowedFromStates as OpportunityStatusValue[]),
          eq(employerOpportunities.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }
}
