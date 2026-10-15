import { Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { requireEmployerId } from "../../career/current-employer.util";
import {
  buildConsultingCursorPage,
  CONSULTING_CURSOR_KINDS,
} from "../../consulting/pagination/consulting-pagination";
import { findingClientView } from "../../security-work/finding-client-view";
import { SecurityWorkRepository } from "../../security-work/repositories/security-work.repository";
import { assessmentClientView } from "../../security-work/services/security-work.service";
import type { BusinessFindingListQuery, BusinessScoreListQuery } from "../dto/security-score.dto";
import { SecurityScoreRepository } from "../repositories/security-score.repository";
import { scoreView } from "../security-score.views";

/** D6C-1 bounded previews. */
const DASHBOARD_PREVIEW_LIMIT = 5;

/**
 * Business security reads (API-SCR-003/004/005). The employer always comes
 * from the session and every query reapplies the employer and release
 * predicates. Current (dashboard) and historical (lists) visibility are
 * deliberately different: D-1/D6-2/D6C-1.
 */
@Injectable()
export class BusinessSecurityService {
  constructor(
    private readonly scores: SecurityScoreRepository,
    private readonly work: SecurityWorkRepository,
  ) {}

  /** API-SCR-003: SecurityDashboardView, exactly four properties. */
  async dashboard(principal: AuthPrincipal) {
    const employerId = requireEmployerId(principal);
    const [current, counts, assessments, actions] = await Promise.all([
      this.scores.currentClientScore(employerId),
      this.scores.currentRiskCounts(employerId),
      this.work.listClientAssessments(employerId, { limit: DASHBOARD_PREVIEW_LIMIT }),
      this.scores.recommendedActions(employerId, DASHBOARD_PREVIEW_LIMIT),
    ]);
    const openRiskCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const { severity, count } of counts) openRiskCounts[severity] = Number(count);
    return {
      currentScore: current ? scoreView(current) : null,
      openRiskCounts,
      recentAssessments: assessments.slice(0, DASHBOARD_PREVIEW_LIMIT).map(assessmentClientView),
      recommendedActions: actions.map(findingClientView),
    };
  }

  /** API-SCR-004: D-1 historical list with live finding values. */
  async findings(principal: AuthPrincipal, query: BusinessFindingListQuery) {
    const rows = await this.scores.listClientFindings(requireEmployerId(principal), query);
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.businessFindings,
      (r) => r.createdAt,
      (r) => r.id,
    );
    return { data: page.data.map(findingClientView), meta: page.meta };
  }

  /** API-SCR-005: D6-2 score history; scores are JSON numbers (D6C-3). */
  async scoreHistory(principal: AuthPrincipal, query: BusinessScoreListQuery) {
    const rows = await this.scores.listClientScores(
      requireEmployerId(principal),
      query.limit,
      query.cursor,
    );
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.businessScores,
      (r) => r.calculatedAt,
      (r) => r.id,
    );
    return { data: page.data.map(scoreView), meta: page.meta };
  }
}
