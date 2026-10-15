import { Injectable } from "@nestjs/common";
import { TransactionManager } from "../../../core/database/transaction.manager";
import {
  NotFoundException,
  ScoreMethodologyNotConfiguredException,
} from "../../../core/errors/app.exception";
import { RequestContextService } from "../../../core/request-context/request-context.service";
import { AuthScopeEvaluator } from "../../../core/security/authorization/auth-scope-evaluator.service";
import { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import {
  buildConsultingCursorPage,
  CONSULTING_CURSOR_KINDS,
} from "../../consulting/pagination/consulting-pagination";
import { ConsultingRequestsRepository } from "../../consulting/repositories/consulting-requests.repository";
import { SecurityWorkRepository } from "../../security-work/repositories/security-work.repository";
import { requireAssessmentAccess } from "../../security-work/security-work-access";
import type { OperationalScoreListQuery, ScoreCalculateInput } from "../dto/security-score.dto";
import { SecurityScoreRepository } from "../repositories/security-score.repository";
import { scoreView } from "../security-score.views";

/**
 * Operational score operations (API-SCR-001/002, Wave 6C per D6C-2).
 *
 * API-SCR-001: GAP-009 is open and no score methodology is approved, so there
 * is no calculation code path at all. An authorised, valid request is
 * re-checked under the request -> assessment locks (dual ASG and current
 * AUTH_SCOPE, exactly as Wave 5B technical actions), the rejected attempt is
 * audited in a transaction that commits, and only then is 409
 * SCORE_METHODOLOGY_NOT_CONFIGURED returned. No security_scores row is ever
 * written. API-SCR-002 reads existing snapshots without AUTH_SCOPE.
 */
@Injectable()
export class SecurityScoreService {
  constructor(
    private readonly scores: SecurityScoreRepository,
    private readonly work: SecurityWorkRepository,
    private readonly requests: ConsultingRequestsRepository,
    private readonly transactions: TransactionManager,
    private readonly authScope: AuthScopeEvaluator,
    private readonly audits: AuditLogsRepository,
    private readonly context: RequestContextService,
  ) {}

  /** API-SCR-001: always the methodology gate while GAP-009 is open. */
  async calculate(
    assessmentId: string,
    principal: AuthPrincipal,
    _input: ScoreCalculateInput,
  ): Promise<never> {
    // The audit transaction must commit before the 409 is raised; throwing
    // inside it would roll the mandatory rejected-attempt audit back.
    await this.transactions.runInTransaction(async () => {
      const initial = await this.work.assessment(assessmentId);
      if (!initial || !(await this.requests.lockById(initial.request.id)))
        throw new NotFoundException();
      const row = await this.work.lockAssessment(assessmentId);
      if (!row) throw new NotFoundException();
      requireAssessmentAccess(row, principal);
      await this.work.lockScope(row.assessment.scopeAuthorizationId);
      if (!(await this.authScope.evaluate({ assessmentId })).allowed) throw new NotFoundException();
      await this.audits.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "security.score.calculation_rejected",
        entityType: "assessment",
        entityId: row.assessment.id,
        employerId: row.assessment.employerId,
        requestId: this.context.getRequestId(),
        metadata: {
          apiId: "API-SCR-001",
          assessmentId: row.assessment.id,
          reason: "SCORE_METHODOLOGY_NOT_CONFIGURED",
        },
      });
    });
    throw new ScoreMethodologyNotConfiguredException();
  }

  /** API-SCR-002: dual-ASG Consultant or Admin; existing snapshots only. */
  async list(assessmentId: string, principal: AuthPrincipal, query: OperationalScoreListQuery) {
    const row = await this.work.assessment(assessmentId);
    if (!row) throw new NotFoundException();
    requireAssessmentAccess(row, principal);
    const rows = await this.scores.listAssessmentScores(
      assessmentId,
      row.assessment.employerId,
      query.limit,
      query.cursor,
    );
    const page = buildConsultingCursorPage(
      rows,
      query.limit,
      CONSULTING_CURSOR_KINDS.operationalScores,
      (r) => r.calculatedAt,
      (r) => r.id,
    );
    return { data: page.data.map(scoreView), meta: page.meta };
  }
}
