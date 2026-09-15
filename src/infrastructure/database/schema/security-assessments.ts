import { index, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { consultingRequests } from "./consulting-requests";
import { employers } from "./employers";
import { assessmentStatus, securityServiceType } from "./enums";
import { securityScopeAuthorizations } from "./security-scope-authorizations";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.30 security_assessments
 * (Owner: BE-ASM | Basis: DR-013 + WF-ASM | Release: MVP v2).
 * "Authorized assessment execution record."
 *
 * Links a technical security engagement to the exact
 * security_scope_authorizations row that authorizes it
 * (`scope_authorization_id`) and to the assigned consultant
 * (`assigned_consultant_id`) — the two facts AuthScopeEvaluator needs to
 * enforce Wave 0D-4B's AUTH_SCOPE + ASG composition. No assessment
 * execution/workflow-transition logic (WF-ASM commands) or findings are
 * implemented here — persistence only, per Wave 0D-4B Phase 7.
 */
export const securityAssessments = pgTable(
  "security_assessments",
  {
    ...primaryUuid,
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id),
    consultingRequestId: uuid("consulting_request_id")
      .notNull()
      .references(() => consultingRequests.id),
    scopeAuthorizationId: uuid("scope_authorization_id")
      .notNull()
      .references(() => securityScopeAuthorizations.id),
    service: securityServiceType("service").notNull(),
    // ERD: "Immutable operational snapshot derived from approved scope,
    // not a new authorization." Recorded for audit/traceability; the live
    // AUTH_SCOPE decision always re-reads the current
    // security_scope_authorizations row via scope_authorization_id, never
    // this snapshot (State & Workflow Spec §6.2: "a single start-time
    // check is not enough for high-risk operations").
    scopeSnapshot: jsonb("scope_snapshot").notNull(),
    assignedConsultantId: uuid("assigned_consultant_id")
      .notNull()
      .references(() => users.id),
    status: assessmentStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("security_assessments_consulting_request_id_idx").on(table.consultingRequestId),
    index("security_assessments_scope_authorization_id_idx").on(table.scopeAuthorizationId),
    index("security_assessments_assigned_consultant_id_idx").on(table.assignedConsultantId),
    index("security_assessments_service_idx").on(table.service),
    index("security_assessments_status_idx").on(table.status),
    index("security_assessments_started_at_idx").on(table.startedAt),
    index("security_assessments_employer_status_created_idx").on(
      table.employerId,
      table.status,
      table.createdAt,
    ),
    index("security_assessments_assigned_consultant_status_idx").on(
      table.assignedConsultantId,
      table.status,
    ),
  ],
);

export type SecurityAssessment = typeof securityAssessments.$inferSelect;
export type NewSecurityAssessment = typeof securityAssessments.$inferInsert;
