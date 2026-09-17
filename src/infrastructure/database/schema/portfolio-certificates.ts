import { boolean, index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { certificates } from "./certificates";
import { portfolios } from "./portfolios";

/**
 * Database ERD & Data Dictionary v2.0 §7.18 portfolio_certificates.
 * "Join between portfolio and platform-issued certificates selected for
 * display." Composite PK — a certificate can appear on its owner's
 * portfolio at most once; ownership of both sides is verified by the
 * service layer, never trusted from this join row alone.
 */
export const portfolioCertificates = pgTable(
  "portfolio_certificates",
  {
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    certificateId: uuid("certificate_id")
      .notNull()
      .references(() => certificates.id),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.portfolioId, table.certificateId] }),
    index("portfolio_certificates_portfolio_id_is_public_sort_order_idx").on(
      table.portfolioId,
      table.isPublic,
      table.sortOrder,
    ),
  ],
);

export type PortfolioCertificate = typeof portfolioCertificates.$inferSelect;
export type NewPortfolioCertificate = typeof portfolioCertificates.$inferInsert;
