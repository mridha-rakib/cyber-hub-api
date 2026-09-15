import { Logger } from "@nestjs/common";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "../database/drizzle.config";

/**
 * Wave 0D-6 Phase 9/10. Generic atomic compare-and-set transition
 * executor for any table shaped like `{ id, status, stateVersion,
 * updatedAt }`. The state+version comparison is part of the UPDATE's own
 * WHERE clause — there is no prior SELECT that decides whether to write;
 * the database itself atomically decides, so two concurrent callers can
 * never both succeed against the same starting version.
 *
 * Multiple `allowedFromStates` are accepted (unioned into one `IN (...)`)
 * to support a single API-level command that is documented as valid from
 * more than one source state under different transition IDs (e.g.
 * WF-ASM-04/WF-ASM-05) — callers must ensure every candidate they pass
 * targets the same `toState` (see workflow-validation.service.ts's
 * `resolveCandidate`, which already picks exactly one candidate before
 * this is called in the real service layer; this repository itself does
 * not resolve candidates, it only executes the already-decided command).
 */
export type CasTransitionOutcome =
  | { readonly outcome: "UPDATED"; readonly newVersion: number; readonly toState: string }
  | { readonly outcome: "NOT_FOUND" }
  /**
   * The row exists but did not match the WHERE clause — either the
   * persisted state is not one of `allowedFromStates`, or the persisted
   * stateVersion no longer equals `expectedVersion` (or both). Both are
   * external 409s; `staleVersionSuspected`/`invalidStateSuspected` are
   * for internal logging only, computed from one diagnostic follow-up
   * read after the failed CAS attempt — never from a read that could have
   * informed the CAS decision itself.
   */
  | {
      readonly outcome: "CONFLICT";
      readonly staleVersionSuspected: boolean;
      readonly invalidStateSuspected: boolean;
    };

export interface CasTransitionTableRefs {
  readonly table: PgTable;
  readonly idColumn: PgColumn;
  readonly statusColumn: PgColumn;
  readonly stateVersionColumn: PgColumn;
  /**
   * Not read by this function (the UPDATE always sets the JS-side
   * `updatedAt` property, which both current workflow tables share) — kept
   * as an explicit part of the contract so a future table with a
   * differently-named timestamp column fails to typecheck here rather
   * than silently skipping the timestamp bump.
   */
  readonly updatedAtColumn: PgColumn;
}

export interface CasTransitionInput {
  readonly resourceId: string;
  readonly allowedFromStates: readonly string[];
  readonly toState: string;
  readonly expectedStateVersion: number;
}

const logger = new Logger("WorkflowTransitionRepository");

/**
 * Executes one atomic compare-and-set transition. Never throws for an
 * ordinary conflict/not-found outcome — those are normal return values.
 * A genuine infrastructure failure (DB error) propagates as a thrown
 * error, exactly like every other repository in this codebase (see
 * SecurityScopeAuthorizationRepository's own doc comment for the same
 * convention applied to reads).
 */
export async function executeCasTransition(
  db: Database,
  refs: CasTransitionTableRefs,
  input: CasTransitionInput,
): Promise<CasTransitionOutcome> {
  const { table, idColumn, statusColumn, stateVersionColumn } = refs;
  const { resourceId, allowedFromStates, toState, expectedStateVersion } = input;

  const rows = await db
    .update(table)
    .set({
      status: toState,
      stateVersion: sql`${stateVersionColumn} + 1`,
      updatedAt: sql`now()`,
    } as Record<string, unknown>)
    .where(
      and(
        eq(idColumn, resourceId),
        inArray(statusColumn, allowedFromStates as string[]),
        eq(stateVersionColumn, expectedStateVersion),
      ) as SQL,
    )
    .returning({ id: idColumn, status: statusColumn, stateVersion: stateVersionColumn });

  if (rows.length > 0) {
    const row = rows[0] as { status: unknown; stateVersion: unknown };
    return {
      outcome: "UPDATED",
      toState: String(row.status),
      newVersion: Number(row.stateVersion),
    };
  }

  // Zero rows updated. Distinguish NOT_FOUND (Phase 23 — never conflated
  // with a real conflict) from CONFLICT via one diagnostic read that
  // happens strictly AFTER the failed atomic write attempt, so it cannot
  // introduce a read-then-write race: it never informs another write.
  const existing = await db
    .select({ status: statusColumn, stateVersion: stateVersionColumn })
    .from(table)
    .where(eq(idColumn, resourceId))
    .limit(1);

  if (existing.length === 0) {
    return { outcome: "NOT_FOUND" };
  }

  const current = existing[0] as { status: unknown; stateVersion: unknown };
  const staleVersionSuspected = Number(current.stateVersion) !== expectedStateVersion;
  const invalidStateSuspected = !allowedFromStates.includes(String(current.status));
  logger.warn(
    `CAS transition conflict for id ${resourceId}: staleVersionSuspected=${staleVersionSuspected} invalidStateSuspected=${invalidStateSuspected}`,
  );
  return { outcome: "CONFLICT", staleVersionSuspected, invalidStateSuspected };
}
