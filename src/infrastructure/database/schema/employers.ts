import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { employerStatus } from "./enums";

export const employers = pgTable(
  "employers",
  {
    ...primaryUuid,
    companyName: text("company_name").notNull(),
    email: text("email").notNull(),
    profile: jsonb("profile").notNull().default({}),
    status: employerStatus("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employers_status_idx").on(table.status),
    index("employers_company_name_idx").on(table.companyName),
  ],
);

export type Employer = typeof employers.$inferSelect;
export type NewEmployer = typeof employers.$inferInsert;
