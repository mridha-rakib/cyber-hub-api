import { boolean, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { portfolios } from "./portfolios";

/** Database ERD & Data Dictionary v2.0 §7.14 portfolio_skills. */
export const portfolioSkills = pgTable(
  "portfolio_skills",
  {
    ...primaryUuid,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    name: text("name").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    unique("portfolio_skills_portfolio_id_name_key").on(table.portfolioId, table.name),
    index("portfolio_skills_portfolio_id_is_public_sort_order_idx").on(
      table.portfolioId,
      table.isPublic,
      table.sortOrder,
    ),
  ],
);

export type PortfolioSkill = typeof portfolioSkills.$inferSelect;
export type NewPortfolioSkill = typeof portfolioSkills.$inferInsert;
