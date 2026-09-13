import { sql } from "drizzle-orm";
import {
  boolean,
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
import { employers } from "./employers";
import { userRole } from "./enums";

export const users = pgTable(
  "users",
  {
    ...primaryUuid,
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    profile: jsonb("profile").notNull().default({}),
    employerId: uuid("employer_id").references(() => employers.id),
    authVersion: integer("auth_version").notNull().default(1),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("users_email_normalized_key").on(table.emailNormalized),
    index("users_role_idx").on(table.role),
    index("users_employer_id_idx").on(table.employerId),
    check(
      "users_email_normalized_lower_check",
      sql`lower(${table.emailNormalized}) = ${table.emailNormalized}`,
    ),
    check("users_auth_version_check", sql`${table.authVersion} >= 1`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
