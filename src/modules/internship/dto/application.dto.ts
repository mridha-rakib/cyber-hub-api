import { z } from "zod";

/**
 * API Contract v1.1 `InternshipApplicationInput` — "exact questions are
 * programme/UI-defined and remain source-limited." No `status`/`userId`/
 * `internshipId` accepted from body: those come from the route locator and
 * the authenticated session, never from client input.
 */
export const internshipApplicationInputSchema = z
  .object({
    applicationData: z.record(z.string(), z.unknown()),
  })
  .strict();

export type InternshipApplicationInput = z.infer<typeof internshipApplicationInputSchema>;
