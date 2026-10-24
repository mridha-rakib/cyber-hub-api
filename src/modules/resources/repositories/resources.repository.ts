import { Injectable } from "@nestjs/common";
import { and, arrayContains, desc, eq, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { preciseTimestampText } from "../../../common/pagination/precise-timestamp-cursor";
import { TransactionManager } from "../../../core/database/transaction.manager";
import { resources } from "../../../infrastructure/database/schema";
import {
  type DecodedResourceCursor,
  featuredContinuation,
  recentContinuation,
} from "../pagination/resource-cursor";
import { type ResourceAdminRow, resourceAdminColumns } from "../resource.views";

type ResourceStatus = ResourceAdminRow["status"];

interface ListFilter {
  readonly q?: string;
  readonly category?: string;
  readonly tag?: string;
  readonly featured?: boolean;
  readonly limit: number;
}

export interface PublicResourceListFilter extends ListFilter {
  readonly sort: "recent" | "featured";
  readonly cursor?: DecodedResourceCursor;
}

export interface AdminResourceListFilter extends ListFilter {
  readonly status?: ResourceStatus;
  readonly cursor?: DecodedResourceCursor;
}

export interface ResourceInsert {
  readonly title: string;
  readonly category: string;
  readonly tags: string[];
  readonly content: unknown;
  readonly featured: boolean;
  readonly status: ResourceStatus;
}

export type ResourceFieldPatch = Partial<
  Pick<ResourceInsert, "title" | "category" | "tags" | "content" | "featured">
>;

/** Literal (case-insensitive) title substring: %, _ and \ never act as LIKE wildcards/escapes (W7C-9). */
export function titleContains(q: string): SQL {
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  return sql`${resources.title} ILIKE ${`%${escaped}%`} ESCAPE '\\'`;
}

export function commonFilters(filter: ListFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.q !== undefined) conditions.push(titleContains(filter.q));
  if (filter.category !== undefined) conditions.push(eq(resources.category, filter.category));
  if (filter.tag !== undefined) conditions.push(arrayContains(resources.tags, [filter.tag]));
  if (filter.featured !== undefined) conditions.push(eq(resources.featured, filter.featured));
  return conditions;
}

/**
 * Wave 7C `resources` persistence (ERD v2.3 §7.5). Every write is one
 * conditional statement on id + permitted status + expected state_version
 * (DB2-DEC-009); edits/transitions increment state_version, deletion checks
 * it without incrementing. Callers run writes inside TransactionManager so
 * the domain audit row commits or rolls back with them.
 */
@Injectable()
export class ResourcesRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async insert(values: ResourceInsert): Promise<ResourceAdminRow> {
    const [row] = await this.db.insert(resources).values(values).returning(resourceAdminColumns);
    return row as ResourceAdminRow;
  }

  async findById(id: string): Promise<ResourceAdminRow | null> {
    const [row] = await this.db
      .select(resourceAdminColumns)
      .from(resources)
      .where(eq(resources.id, id))
      .limit(1);
    return (row as ResourceAdminRow | undefined) ?? null;
  }

  /** PUBLISHED-only by predicate — a draft/archived/missing id is indistinguishable. */
  async findPublishedById(id: string): Promise<ResourceAdminRow | null> {
    const [row] = await this.db
      .select(resourceAdminColumns)
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.status, "PUBLISHED")))
      .limit(1);
    return (row as ResourceAdminRow | undefined) ?? null;
  }

  /** Row lock for the duration of the caller's transaction (serialises concurrent writers). */
  async lockById(id: string): Promise<ResourceAdminRow | null> {
    const [row] = await this.db
      .select(resourceAdminColumns)
      .from(resources)
      .where(eq(resources.id, id))
      .for("update")
      .limit(1);
    return (row as ResourceAdminRow | undefined) ?? null;
  }

  /** EDIT_GUARD write: content fields only; status untouched; state_version + 1. */
  async updateFields(
    id: string,
    allowedStates: readonly ResourceStatus[],
    expectedStateVersion: number,
    patch: ResourceFieldPatch,
  ): Promise<ResourceAdminRow | null> {
    const [row] = await this.db
      .update(resources)
      .set({
        ...patch,
        stateVersion: sql`${resources.stateVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(resources.id, id),
          inArray(resources.status, [...allowedStates]),
          eq(resources.stateVersion, expectedStateVersion),
        ),
      )
      .returning(resourceAdminColumns);
    return (row as ResourceAdminRow | undefined) ?? null;
  }

  /** Lifecycle transition (CAS): status from -> to, optional server-set publishedAt; state_version + 1. */
  async transition(
    id: string,
    fromStates: readonly ResourceStatus[],
    toState: ResourceStatus,
    expectedStateVersion: number,
    options: { readonly setPublishedAtNow: boolean },
  ): Promise<ResourceAdminRow | null> {
    const [row] = await this.db
      .update(resources)
      .set({
        status: toState,
        ...(options.setPublishedAtNow ? { publishedAt: sql`now()` } : {}),
        stateVersion: sql`${resources.stateVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(resources.id, id),
          inArray(resources.status, [...fromStates]),
          eq(resources.stateVersion, expectedStateVersion),
        ),
      )
      .returning(resourceAdminColumns);
    return (row as ResourceAdminRow | undefined) ?? null;
  }

  /** DELETE_GUARD write: removes the row only in an allowed state at the expected version. */
  async deleteGuarded(
    id: string,
    allowedStates: readonly ResourceStatus[],
    expectedStateVersion: number,
  ): Promise<{ id: string; status: ResourceStatus; stateVersion: number } | null> {
    const [row] = await this.db
      .delete(resources)
      .where(
        and(
          eq(resources.id, id),
          inArray(resources.status, [...allowedStates]),
          eq(resources.stateVersion, expectedStateVersion),
        ),
      )
      .returning({
        id: resources.id,
        status: resources.status,
        stateVersion: resources.stateVersion,
      });
    return row ?? null;
  }

  /** API-RES-001: PUBLISHED-only in SQL; recent or featured keyset ordering. */
  async listPublished(filter: PublicResourceListFilter) {
    return this.publishedListQuery(filter) as unknown as Promise<
      (ResourceAdminRow & { cursorSortValue: string })[]
    >;
  }

  /** API-ADMRES-006: every lifecycle state; createdAt desc, id desc. */
  async listAdmin(filter: AdminResourceListFilter) {
    return this.adminListQuery(filter) as unknown as Promise<
      (ResourceAdminRow & { cursorSortValue: string })[]
    >;
  }

  /** The exact API-RES-001 query (exposed un-awaited so its SQL can be asserted without a database). */
  publishedListQuery(filter: PublicResourceListFilter) {
    // published_at is always set by WF-RES-02/04; the predicate keeps the cursor tuple non-null.
    const conditions = [
      eq(resources.status, "PUBLISHED"),
      isNotNull(resources.publishedAt),
      ...commonFilters(filter),
    ];
    if (filter.cursor) {
      conditions.push(
        filter.sort === "featured"
          ? featuredContinuation(
              resources.featured,
              resources.publishedAt,
              resources.id,
              filter.cursor,
            )
          : recentContinuation(resources.publishedAt, resources.id, filter.cursor),
      );
    }
    const order =
      filter.sort === "featured"
        ? [desc(resources.featured), desc(resources.publishedAt), desc(resources.id)]
        : [desc(resources.publishedAt), desc(resources.id)];
    return this.db
      .select({
        ...resourceAdminColumns,
        cursorSortValue: preciseTimestampText(resources.publishedAt),
      })
      .from(resources)
      .where(and(...conditions))
      .orderBy(...order)
      .limit(filter.limit + 1);
  }

  /** The exact API-ADMRES-006 query (exposed un-awaited for SQL assertions). */
  adminListQuery(filter: AdminResourceListFilter) {
    const conditions = commonFilters(filter);
    if (filter.status !== undefined) conditions.push(eq(resources.status, filter.status));
    if (filter.cursor) {
      conditions.push(recentContinuation(resources.createdAt, resources.id, filter.cursor));
    }
    return this.db
      .select({
        ...resourceAdminColumns,
        cursorSortValue: preciseTimestampText(resources.createdAt),
      })
      .from(resources)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(resources.createdAt), desc(resources.id))
      .limit(filter.limit + 1);
  }
}
