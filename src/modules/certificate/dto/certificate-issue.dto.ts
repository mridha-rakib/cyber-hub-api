import { z } from "zod";

/**
 * API Contract v1.1 `CertificateIssueInput`. "Recipient/programme/
 * enrollment/issue time/number/path/status are server-derived." —
 * `enrollmentId` is the route locator (never accepted in the body), and
 * eligibility is revalidated server-side against the enrollment's own
 * persisted `completion_eligibility`, never trusted from the client.
 */
export const certificateIssueSchema = z
  .object({
    completedSkills: z.array(z.string().trim().min(1)).min(1, "At least one skill is required"),
  })
  .strict();

export type CertificateIssueInput = z.infer<typeof certificateIssueSchema>;
