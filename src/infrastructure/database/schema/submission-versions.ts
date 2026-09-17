import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { submissions } from "./submissions";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.25 submission_versions
 * (Owner: BE-SUB | Basis: DB2-DEC-010 — append-only revision history).
 *
 * Implementation note transcribed exactly: **"Application service treats
 * rows as append-only."** No `updated_at`/`deleted_at` — a version, once
 * created, is never modified. Resubmission (WF-SUB-05) inserts a new row
 * rather than rewriting historical evidence.
 */
export const submissionVersions = pgTable(
  "submission_versions",
  {
    ...primaryUuid,
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    versionNo: integer("version_no").notNull(),
    // [SRC] Evidence text/notes at this version — CONFIDENTIAL.
    evidenceText: text("evidence_text"),
    // [SRC] "binary files are linked through stored_objects" — ERD §7.25.
    evidenceMetadata: jsonb("evidence_metadata").notNull().default({}),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("submission_versions_submission_id_version_no_key").on(
      table.submissionId,
      table.versionNo,
    ),
    index("submission_versions_submission_id_created_at_idx").on(
      table.submissionId,
      table.createdAt,
    ),
    check("submission_versions_version_no_check", sql`${table.versionNo} >= 1`),
  ],
);

export type SubmissionVersion = typeof submissionVersions.$inferSelect;
export type NewSubmissionVersion = typeof submissionVersions.$inferInsert;
