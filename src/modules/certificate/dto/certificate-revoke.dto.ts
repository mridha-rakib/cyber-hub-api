import { z } from "zod";

/**
 * API Contract v1.1 documents `ReasonTransitionInput` generically as
 * `{ expectedStateVersion, reason }`, but the ERD's `certificates` table
 * (§7.26) has no `state_version` column — unlike internships/applications/
 * submissions, which do. Rather than inventing an undocumented column to
 * satisfy the generic DTO shape, this Wave uses the table's own `status`
 * as the atomic CAS guard (`CertificatesRepository.revoke` — WHERE
 * status='ISSUED') and accepts only the field the schema actually
 * supports: a required free-text `reason`. This is a deliberate,
 * documented deviation — see Wave 2 report §9.
 */
export const certificateRevokeSchema = z
  .object({
    reason: z.string().trim().min(1, "Reason is required"),
  })
  .strict();

export type CertificateRevokeInput = z.infer<typeof certificateRevokeSchema>;
