import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import type { CasTransitionOutcome } from "../../../core/workflow/transition.repository";
import { executeCasTransition } from "../../../core/workflow/transition.repository";
import {
  consultingRequests,
  type NewConsultingRequest,
  securityAssessments,
  users,
} from "../../../infrastructure/database/schema";
import type { DecodedConsultingCursor } from "../pagination/consulting-pagination";

export type ConsultingStatus = NewConsultingRequest["status"];

/** Only source-approved client intake fields; ownership/lifecycle fields are server-owned. */
export interface ConsultingRequestInput {
  readonly companyDetails: unknown;
  readonly businessSize: string;
  readonly securityConcern: string;
  readonly businessImpact?: string;
  readonly requestedService: NewConsultingRequest["requestedService"];
  readonly environmentDetails?: unknown;
  readonly contactInformation: unknown;
}

export interface ConsultingRequestCreateContext {
  readonly employerId: string;
  readonly submittedByUserId: string;
}

export interface ConsultingRequestListFilter {
  readonly status?: ConsultingStatus;
  readonly employerId?: string;
  readonly cursor?: DecodedConsultingCursor;
  readonly limit: number;
}

@Injectable()
export class ConsultingRequestsRepository {
  constructor(private readonly transactionManager: TransactionManager) {}

  private get db() {
    return this.transactionManager.getExecutor();
  }

  async create(context: ConsultingRequestCreateContext, input: ConsultingRequestInput) {
    const [row] = await this.db
      .insert(consultingRequests)
      .values({
        ...input,
        employerId: context.employerId,
        submittedByUserId: context.submittedByUserId,
        status: "SUBMITTED",
        stateVersion: 1,
      })
      .returning();
    return row;
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(consultingRequests)
      .where(eq(consultingRequests.id, id))
      .limit(1);
    return row ?? null;
  }

  async findOwnById(id: string, employerId: string) {
    const [row] = await this.db
      .select()
      .from(consultingRequests)
      .where(and(eq(consultingRequests.id, id), eq(consultingRequests.employerId, employerId)))
      .limit(1);
    return row ?? null;
  }

  async findOwn(
    employerId: string,
    filterOrStatus: ConsultingRequestListFilter | ConsultingStatus | undefined = undefined,
  ) {
    const filter = this.normalizeFilter(filterOrStatus);
    const conditions = [eq(consultingRequests.employerId, employerId)];
    if (filter.status) conditions.push(eq(consultingRequests.status, filter.status));
    this.addCursorCondition(conditions, filter.cursor);
    return this.db
      .select()
      .from(consultingRequests)
      .where(and(...conditions))
      .orderBy(desc(consultingRequests.submittedAt), desc(consultingRequests.id))
      .limit(filter.limit + 1);
  }

  async findAssigned(
    consultantUserId: string,
    filterOrStatus: ConsultingRequestListFilter | ConsultingStatus | undefined = undefined,
  ) {
    const filter = this.normalizeFilter(filterOrStatus);
    const conditions = [eq(consultingRequests.assignedConsultantId, consultantUserId)];
    if (filter.status) conditions.push(eq(consultingRequests.status, filter.status));
    this.addCursorCondition(conditions, filter.cursor);
    return this.db
      .select()
      .from(consultingRequests)
      .where(and(...conditions))
      .orderBy(desc(consultingRequests.submittedAt), desc(consultingRequests.id))
      .limit(filter.limit + 1);
  }

  async findOperational(filter: ConsultingRequestListFilter) {
    const conditions = [];
    if (filter.status) conditions.push(eq(consultingRequests.status, filter.status));
    if (filter.employerId) conditions.push(eq(consultingRequests.employerId, filter.employerId));
    this.addCursorCondition(conditions, filter.cursor);
    return this.db
      .select()
      .from(consultingRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(consultingRequests.submittedAt), desc(consultingRequests.id))
      .limit(filter.limit + 1);
  }

  /**
   * Assignment is atomic with the ROLE_CONSULTANT check. Returning null means
   * either the request or an eligible consultant did not exist. Assignment is
   * operational context only and never creates AUTH_SCOPE.
   */
  async assignConsultant(id: string, consultantUserId: string) {
    const [row] = await this.db
      .update(consultingRequests)
      .set({ assignedConsultantId: consultantUserId, updatedAt: new Date() })
      .where(
        and(
          eq(consultingRequests.id, id),
          sql`exists (
            select 1 from ${users}
            where ${users.id} = ${consultantUserId}
              and ${users.role} = 'ROLE_CONSULTANT'
          )`,
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Allowed states and target must come from the centralized WF-REQ registry. */
  async transitionWithExtras(
    id: string,
    allowedFromStates: readonly string[],
    toStatus: string,
    expectedVersion: number,
    extra: Partial<NewConsultingRequest>,
    guard?: "AUTH_SCOPE" | "COMPLETION",
  ) {
    const domainGuard =
      guard === "AUTH_SCOPE"
        ? sql`exists (
            select 1 from security_scope_authorizations authz
            where authz.consulting_request_id = ${consultingRequests.id}
              and authz.employer_id = ${consultingRequests.employerId}
              and authz.is_current = true
              and authz.revoked_at is null
              and authz.valid_from <= now()
              and (authz.valid_until is null or authz.valid_until >= now())
          )`
        : guard === "COMPLETION"
          ? sql`exists (
              select 1 from security_assessments assessment
              where assessment.consulting_request_id = ${consultingRequests.id}
            ) and not exists (
              select 1 from security_assessments assessment
              where assessment.consulting_request_id = ${consultingRequests.id}
                and assessment.status <> 'COMPLETED'
            )`
          : undefined;
    const [row] = await this.db
      .update(consultingRequests)
      .set({
        ...extra,
        status: toStatus as ConsultingStatus,
        stateVersion: sql`${consultingRequests.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(consultingRequests.id, id),
          inArray(consultingRequests.status, allowedFromStates as ConsultingStatus[]),
          eq(consultingRequests.stateVersion, expectedVersion),
          domainGuard,
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Wave 4A-compatible primitive retained for direct persistence tests. */
  async compareAndSetTransition(
    id: string,
    expectedStatus: ConsultingStatus,
    toStatus: ConsultingStatus,
    expectedVersion: number,
  ): Promise<CasTransitionOutcome> {
    return executeCasTransition(
      this.db,
      {
        table: consultingRequests,
        idColumn: consultingRequests.id,
        statusColumn: consultingRequests.status,
        stateVersionColumn: consultingRequests.stateVersion,
        updatedAtColumn: consultingRequests.updatedAt,
      },
      {
        resourceId: id,
        allowedFromStates: [expectedStatus],
        toState: toStatus,
        expectedStateVersion: expectedVersion,
      },
    );
  }

  /** Completion is provable only when linked work exists and none remains incomplete. */
  async hasOnlyCompletedLinkedWork(id: string): Promise<boolean> {
    const [count] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        incomplete: sql<number>`count(*) filter (where ${securityAssessments.status} <> 'COMPLETED')::int`,
      })
      .from(securityAssessments)
      .where(eq(securityAssessments.consultingRequestId, id));
    return (count?.total ?? 0) > 0 && (count?.incomplete ?? 0) === 0;
  }

  private addCursorCondition(
    conditions: ReturnType<typeof eq>[],
    cursor?: DecodedConsultingCursor,
  ) {
    if (!cursor) return;
    const continuation = or(
      lt(consultingRequests.submittedAt, cursor.sortValue),
      and(
        eq(consultingRequests.submittedAt, cursor.sortValue),
        lt(consultingRequests.id, cursor.id),
      ),
    );
    if (continuation) conditions.push(continuation);
  }

  private normalizeFilter(
    filterOrStatus: ConsultingRequestListFilter | ConsultingStatus | undefined,
  ): ConsultingRequestListFilter {
    if (typeof filterOrStatus === "object") return filterOrStatus;
    return { status: filterOrStatus, limit: 100 };
  }
}
