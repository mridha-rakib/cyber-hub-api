import { timestamp, uuid } from "drizzle-orm/pg-core";

export const primaryUuid = {
  id: uuid("id").defaultRandom().primaryKey(),
};

export const tenantColumns = {
  companyId: uuid("company_id"),
};

export const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
