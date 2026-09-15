import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employers } from "./employers";
import { consultingStatus, securityServiceType } from "./enums";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.27 consulting_requests
 * (Owner: BE-CON | Basis: DR-010 + WF-REQ | Release: MVP v2).
 *
 * Wave 0D-4B implements this table ONLY as the documented persistence
 * prerequisite for security_scope_authorizations' required FK — no
 * consulting request submission/review controller or workflow transition
 * logic is implemented here (that remains a future product-module wave;
 * WF-REQ transition commands are explicitly out of scope, per Wave 0D-4B
 * Phase 5).
 */
export const consultingRequests = pgTable(
  "consulting_requests",
  {
    ...primaryUuid,
    employerId: uuid("employer_id")
      .notNull()
      .references(() => employers.id),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id),
    companyDetails: jsonb("company_details").notNull(),
    businessSize: text("business_size").notNull(),
    securityConcern: text("security_concern").notNull(),
    businessImpact: text("business_impact"),
    requestedService: securityServiceType("requested_service").notNull(),
    environmentDetails: jsonb("environment_details"),
    contactInformation: jsonb("contact_information").notNull(),
    status: consultingStatus("status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    assignedConsultantId: uuid("assigned_consultant_id").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("consulting_requests_employer_id_idx").on(table.employerId),
    index("consulting_requests_submitted_by_user_id_idx").on(table.submittedByUserId),
    index("consulting_requests_requested_service_idx").on(table.requestedService),
    index("consulting_requests_status_idx").on(table.status),
    index("consulting_requests_assigned_consultant_id_idx").on(table.assignedConsultantId),
    index("consulting_requests_submitted_at_idx").on(table.submittedAt),
    index("consulting_requests_employer_status_submitted_idx").on(
      table.employerId,
      table.status,
      table.submittedAt,
    ),
    index("consulting_requests_assigned_consultant_status_idx").on(
      table.assignedConsultantId,
      table.status,
    ),
    index("consulting_requests_status_submitted_idx").on(table.status, table.submittedAt),
  ],
);

export type ConsultingRequest = typeof consultingRequests.$inferSelect;
export type NewConsultingRequest = typeof consultingRequests.$inferInsert;
