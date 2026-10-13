import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  consultingRequests,
  type NewSecurityAssessment,
  type NewVulnerabilityFinding,
  securityAssessments,
  securityScopeAuthorizations,
  vulnerabilityFindings,
} from "../../../infrastructure/database/schema";
import type { DecodedConsultingCursor } from "../../consulting/pagination/consulting-pagination";
import type { AssessmentListQuery, FindingListQuery } from "../dto/security-work.dto";

@Injectable()
export class SecurityWorkRepository {
  constructor(private readonly transactions: TransactionManager) {}
  private get db() {
    return this.transactions.getExecutor();
  }

  async assessment(id: string) {
    const [row] = await this.db
      .select({ assessment: securityAssessments, request: consultingRequests })
      .from(securityAssessments)
      .innerJoin(
        consultingRequests,
        eq(securityAssessments.consultingRequestId, consultingRequests.id),
      )
      .where(eq(securityAssessments.id, id))
      .limit(1);
    return row ?? null;
  }
  async finding(id: string) {
    const [row] = await this.db
      .select({
        finding: vulnerabilityFindings,
        assessment: securityAssessments,
        request: consultingRequests,
      })
      .from(vulnerabilityFindings)
      .innerJoin(
        securityAssessments,
        eq(vulnerabilityFindings.assessmentId, securityAssessments.id),
      )
      .innerJoin(
        consultingRequests,
        eq(securityAssessments.consultingRequestId, consultingRequests.id),
      )
      .where(eq(vulnerabilityFindings.id, id))
      .limit(1);
    return row ?? null;
  }
  async lockAssessment(id: string) {
    await this.db
      .select({ id: securityAssessments.id })
      .from(securityAssessments)
      .where(eq(securityAssessments.id, id))
      .for("update");
    return this.assessment(id);
  }
  async lockFinding(id: string) {
    await this.db
      .select({ id: vulnerabilityFindings.id })
      .from(vulnerabilityFindings)
      .where(eq(vulnerabilityFindings.id, id))
      .for("update");
    return this.finding(id);
  }
  async lockScope(id: string) {
    const [row] = await this.db
      .select()
      .from(securityScopeAuthorizations)
      .where(eq(securityScopeAuthorizations.id, id))
      .for("share")
      .limit(1);
    return row ?? null;
  }
  async currentScope(requestId: string) {
    const [row] = await this.db
      .select()
      .from(securityScopeAuthorizations)
      .where(
        and(
          eq(securityScopeAuthorizations.consultingRequestId, requestId),
          eq(securityScopeAuthorizations.isCurrent, true),
        ),
      )
      .for("share")
      .limit(1);
    return row ?? null;
  }
  async createAssessment(input: NewSecurityAssessment) {
    const [row] = await this.db.insert(securityAssessments).values(input).returning();
    return row;
  }
  async createFinding(input: NewVulnerabilityFinding) {
    const [row] = await this.db.insert(vulnerabilityFindings).values(input).returning();
    return row;
  }
  async updateAssessment(
    id: string,
    version: number,
    from: readonly string[],
    fields: Partial<NewSecurityAssessment>,
  ) {
    const [row] = await this.db
      .update(securityAssessments)
      .set({
        ...fields,
        stateVersion: sql`${securityAssessments.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(securityAssessments.id, id),
          eq(securityAssessments.stateVersion, version),
          inArray(
            securityAssessments.status,
            from as NonNullable<NewSecurityAssessment["status"]>[],
          ),
        ),
      )
      .returning();
    return row ?? null;
  }
  async updateFinding(
    id: string,
    version: number,
    from: readonly string[],
    fields: Partial<NewVulnerabilityFinding>,
  ) {
    const [row] = await this.db
      .update(vulnerabilityFindings)
      .set({
        ...fields,
        stateVersion: sql`${vulnerabilityFindings.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vulnerabilityFindings.id, id),
          eq(vulnerabilityFindings.stateVersion, version),
          inArray(
            vulnerabilityFindings.status,
            from as NonNullable<NewVulnerabilityFinding["status"]>[],
          ),
        ),
      )
      .returning();
    return row ?? null;
  }
  async listAssessments(query: AssessmentListQuery, consultantId?: string) {
    const filters: SQL[] = [eq(securityAssessments.employerId, consultingRequests.employerId)];
    if (consultantId)
      filters.push(
        eq(securityAssessments.assignedConsultantId, consultantId),
        eq(consultingRequests.assignedConsultantId, consultantId),
      );
    if (query.status) filters.push(eq(securityAssessments.status, query.status));
    if (query.service) filters.push(eq(securityAssessments.service, query.service));
    if (query.employerId) filters.push(eq(securityAssessments.employerId, query.employerId));
    this.addCursor(filters, securityAssessments, query.cursor);
    return this.db
      .select({ assessment: securityAssessments })
      .from(securityAssessments)
      .innerJoin(
        consultingRequests,
        eq(securityAssessments.consultingRequestId, consultingRequests.id),
      )
      .where(and(...filters))
      .orderBy(desc(securityAssessments.createdAt), desc(securityAssessments.id))
      .limit(query.limit + 1);
  }
  async listFindings(assessmentId: string, employerId: string, query: FindingListQuery) {
    const filters: SQL[] = [
      eq(vulnerabilityFindings.assessmentId, assessmentId),
      eq(vulnerabilityFindings.employerId, employerId),
    ];
    if (query.status) filters.push(eq(vulnerabilityFindings.status, query.status));
    if (query.severity) filters.push(eq(vulnerabilityFindings.severity, query.severity));
    this.addCursor(filters, vulnerabilityFindings, query.cursor);
    return this.db
      .select()
      .from(vulnerabilityFindings)
      .where(and(...filters))
      .orderBy(desc(vulnerabilityFindings.createdAt), desc(vulnerabilityFindings.id))
      .limit(query.limit + 1);
  }
  private addCursor(
    filters: SQL[],
    table: typeof securityAssessments | typeof vulnerabilityFindings,
    cursor?: DecodedConsultingCursor,
  ) {
    if (cursor)
      filters.push(
        or(
          lt(table.createdAt, cursor.sortValue),
          and(eq(table.createdAt, cursor.sortValue), lt(table.id, cursor.id)),
        ) as SQL,
      );
  }
}
