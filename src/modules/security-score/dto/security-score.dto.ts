import { z } from "zod";
import { findingSeverity, findingStatus } from "../../../infrastructure/database/schema/enums";
import { CONSULTING_CURSOR_KINDS } from "../../consulting/pagination/consulting-pagination";
import { securityListCursor, securityListLimit } from "../../security-work/dto/security-work.dto";

/**
 * SecurityScoreCalculateInput (API Contract v1.3/v1.4): only a methodology
 * version reference; numeric scores are never accepted from the client.
 */
export const scoreCalculateInputSchema = z
  .object({ methodologyVersion: z.string().trim().min(1) })
  .strict();

/** API-SCR-002: cursor and limit only. */
export const operationalScoreListQuerySchema = z
  .object({
    cursor: securityListCursor(CONSULTING_CURSOR_KINDS.operationalScores),
    limit: securityListLimit,
  })
  .strict();

/** API-SCR-004: severity, status, cursor and limit; employer comes from the session. */
export const businessFindingListQuerySchema = z
  .object({
    severity: z.enum(findingSeverity.enumValues).optional(),
    status: z.enum(findingStatus.enumValues).optional(),
    cursor: securityListCursor(CONSULTING_CURSOR_KINDS.businessFindings),
    limit: securityListLimit,
  })
  .strict();

/** API-SCR-005: cursor and limit only. */
export const businessScoreListQuerySchema = z
  .object({
    cursor: securityListCursor(CONSULTING_CURSOR_KINDS.businessScores),
    limit: securityListLimit,
  })
  .strict();

export type ScoreCalculateInput = z.infer<typeof scoreCalculateInputSchema>;
export type OperationalScoreListQuery = z.infer<typeof operationalScoreListQuerySchema>;
export type BusinessFindingListQuery = z.infer<typeof businessFindingListQuerySchema>;
export type BusinessScoreListQuery = z.infer<typeof businessScoreListQuerySchema>;
