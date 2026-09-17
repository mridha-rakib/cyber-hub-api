import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { portfolios } from "./portfolios";

/** Database ERD & Data Dictionary v2.0 §7.13 portfolio_links. */
export const portfolioLinks = pgTable(
  "portfolio_links",
  {
    ...primaryUuid,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    url: text("url").notNull(),
    label: text("label"),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("portfolio_links_portfolio_id_sort_order_idx").on(table.portfolioId, table.sortOrder),
    index("portfolio_links_portfolio_id_is_public_idx").on(table.portfolioId, table.isPublic),
  ],
);

export type PortfolioLink = typeof portfolioLinks.$inferSelect;
export type NewPortfolioLink = typeof portfolioLinks.$inferInsert;
