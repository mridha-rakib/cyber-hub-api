import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { authTokenPurpose } from "./enums";
import { users } from "./users";

export const authTokens = pgTable(
  "auth_tokens",
  {
    ...primaryUuid,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: authTokenPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    unique("auth_tokens_token_hash_key").on(table.tokenHash),
    index("auth_tokens_user_id_purpose_idx").on(table.userId, table.purpose),
    index("auth_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;
