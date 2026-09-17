import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { certificateStatus } from "./enums";
import { internshipEnrollments } from "./internship-enrollments";
import { internships } from "./internships";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.26 certificates
 * (Owner: BE-CER | Basis: DR-009 + WF-CER | Release: MVP).
 *
 * `UNIQUE(enrollment_id)` is the actual duplicate-issuance guard the ERD
 * defines — "one certificate per enrollment" is enforced structurally, not
 * merely by application logic (Wave 2 Phase 8). `certificate_number` and
 * `verification_path` are both independently unique, opaque, server-
 * generated identifiers (see `CertificateService.issue` — reuses
 * `OpaqueSecretService`, the same secure-random convention as session/CSRF
 * tokens, never a sequential id). No `state_version` column — the ERD does
 * not document one for this table (unlike internships/applications/
 * submissions); revoke uses `status` itself as the atomic CAS guard.
 * `revocation_reason` is a free-text field only — GAP-015 (a fixed reason
 * catalogue / governance workflow) remains unresolved, see
 * `certificate.service.ts`'s revoke() doc comment.
 */
export const certificates = pgTable(
  "certificates",
  {
    ...primaryUuid,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => internships.id),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => internshipEnrollments.id),
    certificateNumber: text("certificate_number").notNull(),
    verificationPath: text("verification_path").notNull(),
    status: certificateStatus("status").notNull(),
    recipientNameSnapshot: text("recipient_name_snapshot").notNull(),
    programmeTitleSnapshot: text("programme_title_snapshot").notNull(),
    completedSkills: text("completed_skills").array().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id),
    // [SRC] "Policy-limited reason; exact reason catalogue remains GAP-015" — ERD §7.26.
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("certificates_enrollment_id_key").on(table.enrollmentId),
    unique("certificates_certificate_number_key").on(table.certificateNumber),
    unique("certificates_verification_path_key").on(table.verificationPath),
    index("certificates_user_id_issued_at_idx").on(table.userId, table.issuedAt),
    index("certificates_status_idx").on(table.status),
  ],
);

export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;
