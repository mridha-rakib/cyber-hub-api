import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { consultingRequests } from "./consulting-requests";
import { employers } from "./employers";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.29 security_scope_authorizations
 * (Owner: BE-CON / BE-ASM | Basis: BR-005/007 + AUTH_SCOPE | Release: MVP
 * v2). "Versioned record of explicit client testing authorization."
 *
 * This is the AUTH_SCOPE source of truth this Wave exists to persist and
 * evaluate. No scope-creation/confirmation/revocation controller is
 * implemented here — only the table, so real rows can be inserted
 * (directly, by test/integration code in this Wave) and evaluated by the
 * new AuthScopeEvaluator. Implementation note from the ERD itself:
 * "Assessment start checks assignment + this exact authorization version +
 * validity/revocation; role alone never authorizes testing."
 */
export const securityScopeAuthorizations = pgTable(
  "security_scope_authorizations",
  {
    ...primaryUuid,
    consultingRequestId: uuid("consulting_request_id")
      .notNull()
      .references(() => consultingRequests.id),
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id),
    versionNo: integer("version_no").notNull(),
    // ERD: "object/array" (API Contract v1.1 ScopeAuthorizationInput) — no
    // further documented sub-schema. Stored as jsonb per the ERD type;
    // the AuthScopeEvaluator treats these as string arrays (see its own
    // documented interpretation note — Wave 0D-4B Phase 13/14).
    authorizedTargets: jsonb("authorized_targets").notNull(),
    allowedActivities: jsonb("allowed_activities").notNull(),
    restrictions: jsonb("restrictions").notNull().default([]),
    confirmedByUserId: uuid("confirmed_by_user_id")
      .notNull()
      .references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("security_scope_authorizations_request_version_key").on(
      table.consultingRequestId,
      table.versionNo,
    ),
    // ERD: "UNIQUE(consulting_request_id) WHERE is_current=true AND
    // revoked_at IS NULL" — a partial unique index is the only way a
    // "contradictory current rows" state (Wave 0D-4B Phase 10/24) can be
    // structurally impossible rather than merely application-checked.
    uniqueIndex("security_scope_authorizations_current_unique")
      .on(table.consultingRequestId)
      .where(sql`${table.isCurrent} = true AND ${table.revokedAt} IS NULL`),
    index("security_scope_authorizations_employer_current_idx").on(
      table.employerId,
      table.isCurrent,
    ),
    index("security_scope_authorizations_consulting_request_id_idx").on(table.consultingRequestId),
    check("security_scope_authorizations_version_no_check", sql`${table.versionNo} >= 1`),
  ],
);

export type SecurityScopeAuthorization = typeof securityScopeAuthorizations.$inferSelect;
export type NewSecurityScopeAuthorization = typeof securityScopeAuthorizations.$inferInsert;
