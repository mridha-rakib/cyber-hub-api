import { DatabaseException } from "../../core/errors/app.exception";
import { securityScores } from "../../infrastructure/database/schema";

/** SecurityScoreView columns: never employerId or calculatedByUserId. */
export const scoreViewColumns = {
  id: securityScores.id,
  assessmentId: securityScores.assessmentId,
  overallScore: securityScores.overallScore,
  websiteSecurityScore: securityScores.websiteSecurityScore,
  networkSecurityScore: securityScores.networkSecurityScore,
  emailSecurityScore: securityScores.emailSecurityScore,
  authenticationSecurityScore: securityScores.authenticationSecurityScore,
  employeeAwarenessScore: securityScores.employeeAwarenessScore,
  cloudSecurityScore: securityScores.cloudSecurityScore,
  backupRecoveryScore: securityScores.backupRecoveryScore,
  methodologyVersion: securityScores.methodologyVersion,
  calculatedAt: securityScores.calculatedAt,
};

export type ScoreViewRow = {
  id: string;
  assessmentId: string;
  overallScore: string;
  websiteSecurityScore: string | null;
  networkSecurityScore: string | null;
  emailSecurityScore: string | null;
  authenticationSecurityScore: string | null;
  employeeAwarenessScore: string | null;
  cloudSecurityScore: string | null;
  backupRecoveryScore: string | null;
  methodologyVersion: string;
  calculatedAt: Date;
};

/**
 * D6C-3: a numeric(5,2) value (returned by the driver as a decimal string) is
 * presented as the exactly equivalent JSON number ("87.50" -> 87.5,
 * "0.00" -> 0). Two-decimal values in 0..100 round-trip exactly through a
 * JavaScript number, so no rounding or decimal library is involved. A value
 * outside the stored contract fails closed with a generic error.
 */
export function scoreNumber(value: string): number;
export function scoreNumber(value: string | null): number | null;
export function scoreNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (
    !/^\d{1,3}(\.\d{1,2})?$/.test(value) ||
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 100
  )
    throw new DatabaseException();
  return parsed;
}

/** SecurityScoreView (API Contract v1.4): one mapper for SCR-002, SCR-003 and SCR-005. */
export function scoreView(row: ScoreViewRow) {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    overallScore: scoreNumber(row.overallScore),
    websiteSecurityScore: scoreNumber(row.websiteSecurityScore),
    networkSecurityScore: scoreNumber(row.networkSecurityScore),
    emailSecurityScore: scoreNumber(row.emailSecurityScore),
    authenticationSecurityScore: scoreNumber(row.authenticationSecurityScore),
    employeeAwarenessScore: scoreNumber(row.employeeAwarenessScore),
    cloudSecurityScore: scoreNumber(row.cloudSecurityScore),
    backupRecoveryScore: scoreNumber(row.backupRecoveryScore),
    methodologyVersion: row.methodologyVersion,
    calculatedAt: row.calculatedAt,
  };
}
