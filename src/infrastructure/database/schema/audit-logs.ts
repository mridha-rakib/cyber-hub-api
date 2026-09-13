import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employers } from "./employers";
import { users } from "./users";

export const auditLogs = pgTable(
  "audit_logs",
  {
    ...primaryUuid,
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorRole: text("actor_role"),
    serviceContext: text("service_context"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    userId: uuid("user_id").references(() => users.id),
    employerId: uuid("employer_id").references(() => employers.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    requestId: text("request_id"),
  },
  (table) => [
    index("audit_logs_timestamp_idx").on(table.timestamp.desc()),
    index("audit_logs_actor_user_id_timestamp_idx").on(table.actorUserId, table.timestamp.desc()),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId, table.timestamp.desc()),
    index("audit_logs_action_timestamp_idx").on(table.action, table.timestamp.desc()),
    index("audit_logs_employer_id_timestamp_idx").on(table.employerId, table.timestamp.desc()),
    index("audit_logs_request_id_idx").on(table.requestId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
