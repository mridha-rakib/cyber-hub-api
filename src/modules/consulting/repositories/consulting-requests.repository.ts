import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import type { CasTransitionOutcome } from "../../../core/workflow/transition.repository";
import { executeCasTransition } from "../../../core/workflow/transition.repository";
import {
  consultingRequests,
  type NewConsultingRequest,
  users,
} from "../../../infrastructure/database/schema";

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

  async findOwn(employerId: string, status?: ConsultingStatus) {
    return this.db
      .select()
      .from(consultingRequests)
      .where(
        status
          ? and(
              eq(consultingRequests.employerId, employerId),
              eq(consultingRequests.status, status),
            )
          : eq(consultingRequests.employerId, employerId),
      )
      .orderBy(desc(consultingRequests.submittedAt), desc(consultingRequests.id));
  }

  async findAssigned(consultantUserId: string, status?: ConsultingStatus) {
    return this.db
      .select()
      .from(consultingRequests)
      .where(
        status
          ? and(
              eq(consultingRequests.assignedConsultantId, consultantUserId),
              eq(consultingRequests.status, status),
            )
          : eq(consultingRequests.assignedConsultantId, consultantUserId),
      )
      .orderBy(desc(consultingRequests.submittedAt), desc(consultingRequests.id));
  }

  async findOperational(status?: ConsultingStatus, employerId?: string) {
    const conditions = [];
    if (status) conditions.push(eq(consultingRequests.status, status));
    if (employerId) conditions.push(eq(consultingRequests.employerId, employerId));
    return this.db
      .select()
      .from(consultingRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(consultingRequests.submittedAt), desc(consultingRequests.id));
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

  /** Expected state and target must come from the centralized WF-REQ registry. */
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
}
