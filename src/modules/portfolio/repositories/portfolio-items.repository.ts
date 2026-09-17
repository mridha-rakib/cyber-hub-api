import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { TransactionManager } from "../../../core/database/transaction.manager";

/**
 * Every §7.12–7.17 portfolio child item table shares exactly these four
 * columns (plus its own business fields) — this generic repository
 * operates only on the shared shape, so the six near-identical item tables
 * (projects/links/skills/certifications/evidence/achievements) don't need
 * six near-identical repository files. Per-item-type Zod schemas (see
 * `dto/portfolio-item.dto.ts`) are the actual field-shape authority; this
 * layer only ever forwards an already-validated object to Drizzle.
 *
 * Drizzle's fluent builder types don't resolve cleanly against a generic
 * `T extends PgTable` parameter (its conditional types expect a concrete
 * table), so the query-builder calls below go through `table` narrowed to
 * plain `PgTable` — a deliberate, contained escape hatch inside this one
 * generic low-level file, not a loss of type safety at any call site
 * (callers still pass a real, concrete table import and get a typed
 * `Record<string, unknown>` row back to narrow themselves).
 */
export interface PortfolioItemTable extends PgTable {
  id: PgColumn;
  portfolioId: PgColumn;
  isPublic: PgColumn;
  sortOrder: PgColumn;
}

@Injectable()
export class PortfolioItemsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async findByPortfolio<T extends PortfolioItemTable>(table: T, portfolioId: string) {
    const plain = table as PgTable;
    return this.db
      .select()
      .from(plain)
      .where(eq(table.portfolioId, portfolioId))
      .orderBy(table.sortOrder);
  }

  async findPublicByPortfolio<T extends PortfolioItemTable>(table: T, portfolioId: string) {
    const plain = table as PgTable;
    return this.db
      .select()
      .from(plain)
      .where(and(eq(table.portfolioId, portfolioId), eq(table.isPublic, true)))
      .orderBy(table.sortOrder);
  }

  async findById<T extends PortfolioItemTable>(table: T, id: string) {
    const plain = table as PgTable;
    const [row] = await this.db.select().from(plain).where(eq(table.id, id)).limit(1);
    return row ?? null;
  }

  async create<T extends PortfolioItemTable>(
    table: T,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const plain = table as PgTable;
    const [row] = await this.db.insert(plain).values(input).returning();
    return row;
  }

  async update<T extends PortfolioItemTable>(
    table: T,
    id: string,
    portfolioId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const plain = table as PgTable;
    const [row] = await this.db
      .update(plain)
      .set(patch)
      .where(and(eq(table.id, id), eq(table.portfolioId, portfolioId)))
      .returning();
    return row ?? null;
  }

  /** Scoped by `portfolioId` too — never deletes an id without confirming it belongs to the caller's own portfolio. */
  async delete<T extends PortfolioItemTable>(
    table: T,
    id: string,
    portfolioId: string,
  ): Promise<boolean> {
    const plain = table as PgTable;
    const rows = await this.db
      .delete(plain)
      .where(and(eq(table.id, id), eq(table.portfolioId, portfolioId)))
      .returning({ id: table.id });
    return rows.length > 0;
  }
}
