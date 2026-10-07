import { Injectable } from "@nestjs/common";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  consultingRequests,
  securityScopeAuthorizations,
  users,
} from "../../../infrastructure/database/schema";

export interface ScopeAuthorizationInput {
  readonly authorizedTargets: unknown;
  readonly allowedActivities: unknown;
  readonly restrictions?: unknown;
  readonly validFrom: Date;
  readonly validUntil?: Date | null;
}

export interface ScopeAuthorizationCreateContext {
  readonly consultingRequestId: string;
  readonly employerId: string;
  readonly confirmedByUserId: string;
}

@Injectable()
export class ScopeAuthorizationsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  /**
   * Serializes versions by locking the parent request, verifies both request
   * and confirming Business user belong to the supplied ORG, supersedes every
   * prior current row, then inserts the next current version atomically.
   */
  async createNextVersion(
    context: ScopeAuthorizationCreateContext,
    input: ScopeAuthorizationInput,
  ) {
    return this.transactionManager.runInTransaction(async () => {
      const [request] = await this.db
        .select({ id: consultingRequests.id, employerId: consultingRequests.employerId })
        .from(consultingRequests)
        .where(eq(consultingRequests.id, context.consultingRequestId))
        .for("update")
        .limit(1);
      if (!request || request.employerId !== context.employerId) return null;

      const [confirmer] = await this.db
        .select({ id: users.id, employerId: users.employerId, role: users.role })
        .from(users)
        .where(eq(users.id, context.confirmedByUserId))
        .limit(1);
      if (confirmer?.role !== "ROLE_BUSINESS" || confirmer.employerId !== context.employerId) {
        return null;
      }

      const [latest] = await this.db
        .select({ versionNo: securityScopeAuthorizations.versionNo })
        .from(securityScopeAuthorizations)
        .where(eq(securityScopeAuthorizations.consultingRequestId, context.consultingRequestId))
        .orderBy(desc(securityScopeAuthorizations.versionNo))
        .limit(1);
      const nextVersion = (latest?.versionNo ?? 0) + 1;
      const now = new Date();

      await this.db
        .update(securityScopeAuthorizations)
        .set({ isCurrent: false, supersededAt: now })
        .where(
          and(
            eq(securityScopeAuthorizations.consultingRequestId, context.consultingRequestId),
            eq(securityScopeAuthorizations.isCurrent, true),
          ),
        );

      const [created] = await this.db
        .insert(securityScopeAuthorizations)
        .values({
          consultingRequestId: context.consultingRequestId,
          employerId: context.employerId,
          versionNo: nextVersion,
          authorizedTargets: input.authorizedTargets,
          allowedActivities: input.allowedActivities,
          restrictions: input.restrictions ?? [],
          confirmedByUserId: context.confirmedByUserId,
          confirmedAt: now,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          isCurrent: true,
        })
        .returning();
      return created;
    });
  }

  async getCurrent(consultingRequestId: string, employerId?: string) {
    const conditions = [
      eq(securityScopeAuthorizations.consultingRequestId, consultingRequestId),
      eq(securityScopeAuthorizations.isCurrent, true),
      isNull(securityScopeAuthorizations.revokedAt),
    ];
    if (employerId) conditions.push(eq(securityScopeAuthorizations.employerId, employerId));
    const [row] = await this.db
      .select()
      .from(securityScopeAuthorizations)
      .where(and(...conditions))
      .limit(1);
    return row ?? null;
  }

  async getCurrentValid(consultingRequestId: string, at: Date, employerId?: string) {
    const conditions = [
      eq(securityScopeAuthorizations.consultingRequestId, consultingRequestId),
      eq(securityScopeAuthorizations.isCurrent, true),
      isNull(securityScopeAuthorizations.revokedAt),
      lte(securityScopeAuthorizations.validFrom, at),
      or(
        isNull(securityScopeAuthorizations.validUntil),
        gt(securityScopeAuthorizations.validUntil, at),
      ) ?? sql`false`,
    ];
    if (employerId) conditions.push(eq(securityScopeAuthorizations.employerId, employerId));
    const [row] = await this.db
      .select()
      .from(securityScopeAuthorizations)
      .where(and(...conditions))
      .limit(1);
    return row ?? null;
  }
}
