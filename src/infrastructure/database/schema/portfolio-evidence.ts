import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { portfolios } from "./portfolios";

/**
 * Database ERD & Data Dictionary v2.0 §7.16 portfolio_evidence.
 * "Lab/evidence entries; binary files are in stored_objects." — GAP-013
 * (no `stored_objects` infrastructure exists yet) means only the text
 * title/description portion is populated in this Wave; no file reference
 * column is added here since none is documented independently of that
 * unresolved storage dependency.
 */
export const portfolioEvidence = pgTable(
  "portfolio_evidence",
  {
    ...primaryUuid,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    title: text("title").notNull(),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("portfolio_evidence_portfolio_id_is_public_sort_order_idx").on(
      table.portfolioId,
      table.isPublic,
      table.sortOrder,
    ),
  ],
);

export type PortfolioEvidence = typeof portfolioEvidence.$inferSelect;
export type NewPortfolioEvidence = typeof portfolioEvidence.$inferInsert;
