import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  consultingRequests,
  type NewSecurityReport,
  type SecurityReport,
  securityAssessments,
  securityReportFindings,
  securityReports,
  vulnerabilityFindings,
} from "../../../infrastructure/database/schema";
import type { ReportListQuery } from "../dto/security-report.dto";

/** SecurityReportOperationalSummaryView columns (API Contract v1.3, D6-9). */
const summaryColumns = {
  id: securityReports.id,
  assessmentId: securityReports.assessmentId,
  status: securityReports.status,
  versionNo: securityReports.versionNo,
  stateVersion: securityReports.stateVersion,
  supersedesReportId: securityReports.supersedesReportId,
  releasedAt: securityReports.releasedAt,
  createdAt: securityReports.createdAt,
  updatedAt: securityReports.updatedAt,
};

@Injectable()
export class SecurityReportRepository {
  constructor(private readonly transactions: TransactionManager) {}
  private get db() {
    return this.transactions.getExecutor();
  }

  /** Report with its assessment and consulting request (authorization linkage). */
  async report(id: string) {
    const [row] = await this.db
      .select({
        report: securityReports,
        assessment: securityAssessments,
        request: consultingRequests,
      })
      .from(securityReports)
      .innerJoin(securityAssessments, eq(securityReports.assessmentId, securityAssessments.id))
      .innerJoin(
        consultingRequests,
        eq(securityAssessments.consultingRequestId, consultingRequests.id),
      )
      .where(eq(securityReports.id, id))
      .limit(1);
    return row ?? null;
  }
  /** Row locks in deterministic id order (callers already hold request -> assessment). */
  async lockReports(ids: readonly string[]) {
    const sorted = [...new Set(ids)].sort();
    if (sorted.length === 0) return;
    await this.db
      .select({ id: securityReports.id })
      .from(securityReports)
      .where(inArray(securityReports.id, sorted))
      .orderBy(asc(securityReports.id))
      .for("update");
  }
  /**
   * Next monotonic version. Only safe while the caller holds the assessment
   * row lock: under READ COMMITTED this fresh statement sees every report
   * committed by an earlier lock holder (UNIQUE(assessment_id, version_no)
   * remains the backstop).
   */
  async nextVersionNo(assessmentId: string) {
    const [row] = await this.db
      .select({ next: sql<number>`coalesce(max(${securityReports.versionNo}), 0) + 1` })
      .from(securityReports)
      .where(eq(securityReports.assessmentId, assessmentId));
    return Number(row.next);
  }
  async create(input: NewSecurityReport) {
    const [row] = await this.db.insert(securityReports).values(input).returning();
    return row;
  }
  /** Ids from `ids` that belong to the assessment and employer. */
  async linkedFindingIds(ids: readonly string[], assessmentId: string, employerId: string) {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: vulnerabilityFindings.id })
      .from(vulnerabilityFindings)
      .where(
        and(
          inArray(vulnerabilityFindings.id, [...ids]),
          eq(vulnerabilityFindings.assessmentId, assessmentId),
          eq(vulnerabilityFindings.employerId, employerId),
        ),
      );
    return rows.map((row) => row.id);
  }
  async memberships(reportId: string) {
    return this.db
      .select({ membership: securityReportFindings, finding: vulnerabilityFindings })
      .from(securityReportFindings)
      .innerJoin(
        vulnerabilityFindings,
        eq(securityReportFindings.findingId, vulnerabilityFindings.id),
      )
      .where(eq(securityReportFindings.reportId, reportId))
      .orderBy(asc(securityReportFindings.sortOrder), asc(securityReportFindings.findingId));
  }
  async membershipCount(reportId: string) {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(securityReportFindings)
      .where(eq(securityReportFindings.reportId, reportId));
    return Number(row.count);
  }
  async insertMemberships(reportId: string, findings: { findingId: string; sortOrder: number }[]) {
    if (findings.length === 0) return;
    await this.db
      .insert(securityReportFindings)
      .values(findings.map((finding) => ({ reportId, ...finding })));
  }
  async deleteMemberships(reportId: string, findingIds: readonly string[]) {
    if (findingIds.length === 0) return;
    await this.db
      .delete(securityReportFindings)
      .where(
        and(
          eq(securityReportFindings.reportId, reportId),
          inArray(securityReportFindings.findingId, [...findingIds]),
        ),
      );
  }
  async setSortOrder(reportId: string, findingId: string, sortOrder: number) {
    await this.db
      .update(securityReportFindings)
      .set({ sortOrder })
      .where(
        and(
          eq(securityReportFindings.reportId, reportId),
          eq(securityReportFindings.findingId, findingId),
        ),
      );
  }
  /** Guarded CAS: id + expected stateVersion + allowed source states. */
  async update(
    id: string,
    version: number,
    from: readonly string[],
    fields: Partial<NewSecurityReport>,
  ) {
    const [row] = await this.db
      .update(securityReports)
      .set({
        ...fields,
        stateVersion: sql`${securityReports.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(securityReports.id, id),
          eq(securityReports.stateVersion, version),
          inArray(securityReports.status, from as SecurityReport["status"][]),
        ),
      )
      .returning();
    return row ?? null;
  }
  /**
   * D6-8 lineage write on the replacement only: supersedes_report_id is set
   * while it is still an unlinked RELEASED report of the same assessment and
   * employer. No status, stateVersion or updatedAt change.
   */
  async recordLineage(replacementId: string, old: SecurityReport) {
    const [row] = await this.db
      .update(securityReports)
      .set({ supersedesReportId: old.id })
      .where(
        and(
          eq(securityReports.id, replacementId),
          eq(securityReports.status, "RELEASED"),
          isNull(securityReports.supersedesReportId),
          eq(securityReports.assessmentId, old.assessmentId),
          eq(securityReports.employerId, old.employerId),
        ),
      )
      .returning();
    return row ?? null;
  }
  /** API-RPT-013: reports of one authorized assessment, newest first. */
  async list(assessmentId: string, employerId: string, query: ReportListQuery) {
    const filters: SQL[] = [
      eq(securityReports.assessmentId, assessmentId),
      eq(securityReports.employerId, employerId),
    ];
    if (query.status) filters.push(eq(securityReports.status, query.status));
    if (query.cursor)
      filters.push(
        or(
          lt(securityReports.createdAt, query.cursor.sortValue),
          and(
            eq(securityReports.createdAt, query.cursor.sortValue),
            lt(securityReports.id, query.cursor.id),
          ),
        ) as SQL,
      );
    return this.db
      .select(summaryColumns)
      .from(securityReports)
      .where(and(...filters))
      .orderBy(desc(securityReports.createdAt), desc(securityReports.id))
      .limit(query.limit + 1);
  }
}
