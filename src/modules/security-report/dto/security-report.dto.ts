import { z } from "zod";
import { reportStatus } from "../../../infrastructure/database/schema/enums";
import { transitionInputSchema } from "../../consulting/dto/consulting.dto";
import { CONSULTING_CURSOR_KINDS } from "../../consulting/pagination/consulting-pagination";
import { securityListCursor, securityListLimit } from "../../security-work/dto/security-work.dto";

/**
 * API Contract v1.3 report input DTOs. Every schema is strict: owner,
 * assessment, employer, status, version, preparer/reviewer/releaser, lineage,
 * report path and timestamps are server-derived and rejected (422) if sent.
 */
const expectedStateVersion = transitionInputSchema.shape.expectedStateVersion;
/** A JSON object (never an array, scalar or null); `{}` is allowed until submit. */
const draftContent = z.record(z.string(), z.unknown());
const findingIds = z.array(z.uuid());

export const reportCreateInputSchema = z
  .object({ draftContent, findingIds: findingIds.optional() })
  .strict();
export const reportUpdateInputSchema = z
  .object({ draftContent: draftContent.optional(), expectedStateVersion })
  .strict();
export const reportFindingMembershipInputSchema = z
  .object({ findingIds, expectedStateVersion })
  .strict();
export const reportReleaseInputSchema = z
  .object({ expectedStateVersion, storedObjectId: z.uuid() })
  .strict();
export const reportSupersedeInputSchema = z
  .object({ expectedStateVersion, replacementReportId: z.uuid() })
  .strict();

/** API-RPT-013 query: only status, cursor and limit (D6-9). */
export const reportListQuerySchema = z
  .object({
    status: z.enum(reportStatus.enumValues).optional(),
    cursor: securityListCursor(CONSULTING_CURSOR_KINDS.reports),
    limit: securityListLimit,
  })
  .strict();

export type ReportCreateInput = z.infer<typeof reportCreateInputSchema>;
export type ReportUpdateInput = z.infer<typeof reportUpdateInputSchema>;
export type ReportFindingMembershipInput = z.infer<typeof reportFindingMembershipInputSchema>;
export type ReportReleaseInput = z.infer<typeof reportReleaseInputSchema>;
export type ReportSupersedeInput = z.infer<typeof reportSupersedeInputSchema>;
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;
