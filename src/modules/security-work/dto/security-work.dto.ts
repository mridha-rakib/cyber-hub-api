import { z } from "zod";
import {
  assessmentStatus,
  findingSeverity,
  findingStatus,
  securityServiceType,
} from "../../../infrastructure/database/schema/enums";
import { transitionInputSchema } from "../../consulting/dto/consulting.dto";
import {
  CONSULTING_CURSOR_KINDS,
  type ConsultingCursorKind,
  decodeConsultingCursor,
} from "../../consulting/pagination/consulting-pagination";

const text = z.string().trim().min(1);
export const assessmentCreateInputSchema = z.object({}).strict();
export const findingCreateInputSchema = z
  .object({
    title: text,
    severity: z.enum(findingSeverity.enumValues),
    description: text.optional(),
    evidenceSummary: text.optional(),
    recommendation: text,
  })
  .strict();
export const findingUpdateInputSchema = findingCreateInputSchema
  .partial()
  .extend({
    expectedStateVersion: transitionInputSchema.shape.expectedStateVersion,
  })
  .strict();
export const resolutionInputSchema = transitionInputSchema
  .extend({ verificationNote: text })
  .strict();
const limit = z.preprocess(
  (value) =>
    value === undefined
      ? 25
      : typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : value,
  z.number().int().min(1).max(100),
);
const cursor = (kind: ConsultingCursorKind) =>
  z
    .string()
    .min(1)
    .max(512)
    .transform((value, ctx) => {
      const parsed = decodeConsultingCursor(value, kind);
      if (parsed) return parsed;
      ctx.addIssue({ code: "custom", message: "Cursor is invalid" });
      return z.NEVER;
    })
    .optional();

/** Shared security list pagination primitives (default 25, max 100; per-kind cursor). */
export { cursor as securityListCursor, limit as securityListLimit };
export const assessmentListQuerySchema = z
  .object({
    status: z.enum(assessmentStatus.enumValues).optional(),
    service: z.enum(securityServiceType.enumValues).optional(),
    employerId: z.uuid().optional(),
    cursor: cursor(CONSULTING_CURSOR_KINDS.assessments),
    limit,
  })
  .strict();
/**
 * API-ASM-007 (Business). Employer identity always comes from the session;
 * employerId/service and any unknown parameter are rejected (strict).
 */
export const businessAssessmentListQuerySchema = z
  .object({
    status: z.enum(assessmentStatus.enumValues).optional(),
    cursor: cursor(CONSULTING_CURSOR_KINDS.businessAssessments),
    limit,
  })
  .strict();
export const findingListQuerySchema = z
  .object({
    severity: z.enum(findingSeverity.enumValues).optional(),
    status: z.enum(findingStatus.enumValues).optional(),
    cursor: cursor(CONSULTING_CURSOR_KINDS.findings),
    limit,
  })
  .strict();
export type FindingCreateInput = z.infer<typeof findingCreateInputSchema>;
export type FindingUpdateInput = z.infer<typeof findingUpdateInputSchema>;
export type ResolutionInput = z.infer<typeof resolutionInputSchema>;
export type AssessmentListQuery = z.infer<typeof assessmentListQuerySchema>;
export type FindingListQuery = z.infer<typeof findingListQuerySchema>;
export type BusinessAssessmentListQuery = z.infer<typeof businessAssessmentListQuerySchema>;
