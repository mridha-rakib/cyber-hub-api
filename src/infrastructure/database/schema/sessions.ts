import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { users } from "./users";

export const sessions = pgTable(
  "sessions",
  {
    ...primaryUuid,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionKeyHash: text("session_key_hash").notNull(),
    authVersion: integer("auth_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("sessions_session_key_hash_key").on(table.sessionKeyHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
    check("sessions_auth_version_check", sql`${table.authVersion} >= 1`),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
