import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { portfolios } from "./portfolios";

/** Database ERD & Data Dictionary v2.0 §7.15 portfolio_certifications (external/non-platform). */
export const portfolioCertifications = pgTable(
  "portfolio_certifications",
  {
    ...primaryUuid,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    title: text("title").notNull(),
    issuer: text("issuer"),
    credentialUrl: text("credential_url"),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("portfolio_certifications_portfolio_id_is_public_sort_order_idx").on(
      table.portfolioId,
      table.isPublic,
      table.sortOrder,
    ),
  ],
);

export type PortfolioCertification = typeof portfolioCertifications.$inferSelect;
export type NewPortfolioCertification = typeof portfolioCertifications.$inferInsert;
