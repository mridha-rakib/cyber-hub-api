import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { internships, type NewInternship } from "../../../infrastructure/database/schema";

type InternshipStatusValue = NewInternship["status"];

export interface InternshipListFilter {
  readonly status?: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit: number;
}

@Injectable()
export class InternshipsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(internships).where(eq(internships.id, id)).limit(1);
    return row ?? null;
  }

  /** Public catalogue — PUBLISHED only, never widened by caller-supplied status. */
  async findPublishedList(filter: Omit<InternshipListFilter, "status">) {
    const conditions = [eq(internships.status, "PUBLISHED")];
    if (filter.cursor) conditions.push(sql`${internships.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(internships)
      .where(and(...conditions))
      .orderBy(internships.id)
      .limit(filter.limit);
  }

  /** Admin catalogue — every lifecycle status, optional status/title filter. */
  async findAdminList(filter: InternshipListFilter) {
    const conditions = [];
    if (filter.status)
      conditions.push(eq(internships.status, filter.status as InternshipStatusValue));
    if (filter.q) conditions.push(sql`${internships.title} ILIKE ${`%${filter.q}%`}`);
    if (filter.cursor) conditions.push(sql`${internships.id} > ${filter.cursor}`);

    return this.db
      .select()
      .from(internships)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(internships.createdAt))
      .limit(filter.limit);
  }

  async create(input: NewInternship) {
    const [row] = await this.db.insert(internships).values(input).returning();
    return row;
  }

  /**
   * Atomic CAS transition + extra column writes in one UPDATE.
   * `allowedFromStates`/`toState` always come from the caller's lookup into
   * the Wave 0D-6 workflow registry (`getWorkflowDefinition("InternshipProgramme")`)
   * — never hardcoded here.
   */
  async transitionWithExtras(
    id: string,
    allowedFromStates: readonly string[],
    toState: string,
    expectedStateVersion: number,
    extra: Partial<NewInternship>,
  ) {
    const [row] = await this.db
      .update(internships)
      .set({
        ...extra,
        status: toState as InternshipStatusValue,
        stateVersion: sql`${internships.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(internships.id, id),
          inArray(internships.status, allowedFromStates as InternshipStatusValue[]),
          eq(internships.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * EDIT_GUARD update (API-INT-004): allowed only while the row's current
   * status is one of `allowedStates` (per `workflow-operation-map.ts` — the
   * spec's "DRAFT-only configuration" rule), and only at the exact expected
   * `stateVersion`. This never changes `status` itself — content edits are
   * not a workflow transition — but still bumps `stateVersion` so a
   * concurrent edit + publish race can't silently interleave.
   */
  async updateWithGuard(
    id: string,
    allowedStates: readonly string[],
    expectedStateVersion: number,
    patch: Partial<NewInternship>,
  ) {
    const [row] = await this.db
      .update(internships)
      .set({ ...patch, stateVersion: sql`${internships.stateVersion} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(internships.id, id),
          inArray(internships.status, allowedStates as InternshipStatusValue[]),
          eq(internships.stateVersion, expectedStateVersion),
        ),
      )
      .returning();
    return row ?? null;
  }
}
