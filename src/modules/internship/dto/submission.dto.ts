import { z } from "zod";

/**
 * API Contract v1.1 `SubmissionCreateInput`. `storedObjectIds` is accepted
 * in shape only — actual file/object storage is out of scope for this Wave
 * (GAP-013 unresolved); no upload endpoint exists yet for a client to have
 * obtained a real id from, so in practice this stays empty until a future
 * wave resolves file storage. Text/metadata evidence works independently.
 */
export const submissionCreateSchema = z
  .object({
    evidenceText: z.string().trim().min(1).optional(),
    evidenceMetadata: z.record(z.string(), z.unknown()).optional(),
    storedObjectIds: z.array(z.uuid()).optional(),
  })
  .strict();

export type SubmissionCreateInput = z.infer<typeof submissionCreateSchema>;

/** API Contract v1.1 `SubmissionResubmitInput`. */
export const submissionResubmitSchema = z
  .object({
    expectedStateVersion: z.number().int().min(1),
    evidenceText: z.string().trim().min(1).optional(),
    evidenceMetadata: z.record(z.string(), z.unknown()).optional(),
    storedObjectIds: z.array(z.uuid()).optional(),
  })
  .strict();

export type SubmissionResubmitInput = z.infer<typeof submissionResubmitSchema>;
