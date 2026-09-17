import { z } from "zod";

/** API Contract v1.1 `ReviewApprovalInput`. */
export const reviewApprovalSchema = z
  .object({
    expectedStateVersion: z.number().int().min(1),
    reviewNote: z.string().trim().min(1).optional(),
  })
  .strict();

export type ReviewApprovalInput = z.infer<typeof reviewApprovalSchema>;

/** API Contract v1.1 `RevisionRequestInput` — feedback is required. */
export const revisionRequestSchema = z
  .object({
    expectedStateVersion: z.number().int().min(1),
    feedback: z.string().trim().min(1, "Feedback is required"),
  })
  .strict();

export type RevisionRequestInput = z.infer<typeof revisionRequestSchema>;

/**
 * API Contract v1.1 `CompletionEvaluationInput`. `expectedEligibility` is
 * explicitly documented as "Optional UI expectation only; server computes
 * authoritative eligibility" — never used to decide the outcome.
 */
export const completionEvaluationSchema = z
  .object({
    evaluationNote: z.string().trim().min(1).optional(),
    expectedEligibility: z.enum(["NOT_ELIGIBLE", "ELIGIBLE"]).optional(),
  })
  .strict();

export type CompletionEvaluationInput = z.infer<typeof completionEvaluationSchema>;
