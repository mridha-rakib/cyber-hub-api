import { Injectable } from "@nestjs/common";
import { and, desc, eq, exists, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  consultingRequests,
  type SecurityReport,
  securityAssessments,
  securityReportFindings,
  securityReports,
  securityScores,
  vulnerabilityFindings,
} from "../../../infrastructure/database/schema";
import type { DecodedConsultingCursor } from "../../consulting/pagination/consulting-pagination";
import { findingClientColumns } from "../../security-work/finding-client-view";
import type { BusinessFindingListQuery } from "../dto/security-score.dto";
import { scoreViewColumns } from "../security-score.views";

type ReportStatus = SecurityReport["status"];
/** D-1 / D6-2 historical visibility: RELEASED or SUPERSEDED. */
const HISTORICAL: ReportStatus[] = ["RELEASED", "SUPERSEDED"];
/** D-1 / D6-2 current dashboard: currently RELEASED only. */
const CURRENT: ReportStatus[] = ["RELEASED"];
const OPEN_RISK = ["OPEN", "REMEDIATION_IN_PROGRESS"] as const;

/**
 * Business security reads (API-SCR-003/004/005) and operational score history
 * (API-SCR-002). Visibility is derived only from report membership/status
 * (no visibility column) and expressed as correlated EXISTS predicates, so a
 * finding or snapshot referenced by several reports is returned or counted
 * once and pagination operates on unique rows.
 */
@Injectable()
export class SecurityScoreRepository {
  constructor(private readonly transactions: TransactionManager) {}
  private get db() {
    return this.transactions.getExecutor();
  }

  /** Finding is in at least one own-employer report of its assessment in `statuses`. */
  private findingReleased(employerId: string, statuses: ReportStatus[]) {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(securityReportFindings)
        .innerJoin(securityReports, eq(securityReportFindings.reportId, securityReports.id))
        .where(
          and(
            eq(securityReportFindings.findingId, vulnerabilityFindings.id),
            eq(securityReports.assessmentId, vulnerabilityFindings.assessmentId),
            eq(securityReports.employerId, employerId),
            inArray(securityReports.status, statuses),
          ),
        ),
    );
  }
  /** Score's assessment has at least one own-employer report in `statuses`. */
  private scoreReleased(employerId: string, statuses: ReportStatus[]) {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(securityReports)
        .where(
          and(
            eq(securityReports.assessmentId, securityScores.assessmentId),
            eq(securityReports.employerId, employerId),
            inArray(securityReports.status, statuses),
          ),
        ),
    );
  }
  /** Finding, assessment and consulting request all belong to the employer. */
  private findingOrg(employerId: string): SQL[] {
    return [
      eq(vulnerabilityFindings.employerId, employerId),
      eq(securityAssessments.employerId, employerId),
      eq(consultingRequests.employerId, employerId),
    ];
  }
  /** Joins a finding select to its assessment and consulting request (ORG linkage). */
  private withFindingLinks<T extends PgSelect>(query: T) {
    return query
      .innerJoin(
        securityAssessments,
        eq(vulnerabilityFindings.assessmentId, securityAssessments.id),
      )
      .innerJoin(
        consultingRequests,
        eq(securityAssessments.consultingRequestId, consultingRequests.id),
      );
  }
  private currentRiskFilters(employerId: string): SQL[] {
    return [
      ...this.findingOrg(employerId),
      inArray(vulnerabilityFindings.status, [...OPEN_RISK]),
      this.findingReleased(employerId, CURRENT),
    ];
  }

  /** API-SCR-004: D-1 list (RELEASED or SUPERSEDED membership), newest first. */
  async listClientFindings(employerId: string, query: BusinessFindingListQuery) {
    const filters = [...this.findingOrg(employerId), this.findingReleased(employerId, HISTORICAL)];
    if (query.severity) filters.push(eq(vulnerabilityFindings.severity, query.severity));
    if (query.status) filters.push(eq(vulnerabilityFindings.status, query.status));
    if (query.cursor)
      filters.push(
        cursorAfter(vulnerabilityFindings.createdAt, vulnerabilityFindings.id, query.cursor),
      );
    return this.withFindingLinks(
      this.db.select(findingClientColumns).from(vulnerabilityFindings).$dynamic(),
    )
      .where(and(...filters))
      .orderBy(desc(vulnerabilityFindings.createdAt), desc(vulnerabilityFindings.id))
      .limit(query.limit + 1);
  }

  /** API-SCR-003 openRiskCounts: one row per finding, grouped by live severity. */
  async currentRiskCounts(employerId: string) {
    return this.withFindingLinks(
      this.db
        .select({ severity: vulnerabilityFindings.severity, count: sql<number>`count(*)::int` })
        .from(vulnerabilityFindings)
        .$dynamic(),
    )
      .where(and(...this.currentRiskFilters(employerId)))
      .groupBy(vulnerabilityFindings.severity);
  }

  /** API-SCR-003 recommendedActions: severity CRITICAL..LOW, then createdAt/id descending. */
  async recommendedActions(employerId: string, limit: number) {
    return this.withFindingLinks(
      this.db.select(findingClientColumns).from(vulnerabilityFindings).$dynamic(),
    )
      .where(and(...this.currentRiskFilters(employerId)))
      .orderBy(
        sql`case ${vulnerabilityFindings.severity} when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end`,
        desc(vulnerabilityFindings.createdAt),
        desc(vulnerabilityFindings.id),
      )
      .limit(limit);
  }

  private clientScoreQuery(employerId: string, statuses: ReportStatus[], extra: SQL[] = []) {
    return this.db
      .select(scoreViewColumns)
      .from(securityScores)
      .innerJoin(securityAssessments, eq(securityScores.assessmentId, securityAssessments.id))
      .innerJoin(
        consultingRequests,
        eq(securityAssessments.consultingRequestId, consultingRequests.id),
      )
      .where(
        and(
          eq(securityScores.employerId, employerId),
          eq(securityAssessments.employerId, employerId),
          eq(consultingRequests.employerId, employerId),
          this.scoreReleased(employerId, statuses),
          ...extra,
        ),
      )
      .orderBy(desc(securityScores.calculatedAt), desc(securityScores.id));
  }

  /** API-SCR-005: D6-2 history (RELEASED or SUPERSEDED report on the assessment). */
  async listClientScores(employerId: string, limit: number, cursor?: DecodedConsultingCursor) {
    return this.clientScoreQuery(
      employerId,
      HISTORICAL,
      cursor ? [cursorAfter(securityScores.calculatedAt, securityScores.id, cursor)] : [],
    ).limit(limit + 1);
  }

  /** API-SCR-003 currentScore: latest snapshot of an assessment with a currently RELEASED report. */
  async currentClientScore(employerId: string) {
    const [row] = await this.clientScoreQuery(employerId, CURRENT).limit(1);
    return row ?? null;
  }

  /** API-SCR-002: one authorized assessment's snapshot history, newest first. */
  async listAssessmentScores(
    assessmentId: string,
    employerId: string,
    limit: number,
    cursor?: DecodedConsultingCursor,
  ) {
    const filters: SQL[] = [
      eq(securityScores.assessmentId, assessmentId),
      eq(securityScores.employerId, employerId),
    ];
    if (cursor) filters.push(cursorAfter(securityScores.calculatedAt, securityScores.id, cursor));
    return this.db
      .select(scoreViewColumns)
      .from(securityScores)
      .where(and(...filters))
      .orderBy(desc(securityScores.calculatedAt), desc(securityScores.id))
      .limit(limit + 1);
  }
}

function cursorAfter(
  sortColumn: typeof vulnerabilityFindings.createdAt | typeof securityScores.calculatedAt,
  idColumn: typeof vulnerabilityFindings.id | typeof securityScores.id,
  cursor: DecodedConsultingCursor,
) {
  return or(
    lt(sortColumn, cursor.sortValue),
    and(eq(sortColumn, cursor.sortValue), lt(idColumn, cursor.id)),
  ) as SQL;
}
