import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { internships } from "./internships";
import { portfolios } from "./portfolios";

/** Database ERD & Data Dictionary v2.0 §7.17 portfolio_achievements. */
export const portfolioAchievements = pgTable(
  "portfolio_achievements",
  {
    ...primaryUuid,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    internshipId: uuid("internship_id").references(() => internships.id),
    title: text("title").notNull(),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("portfolio_achievements_portfolio_id_is_public_sort_order_idx").on(
      table.portfolioId,
      table.isPublic,
      table.sortOrder,
    ),
    index("portfolio_achievements_internship_id_idx").on(table.internshipId),
  ],
);

export type PortfolioAchievement = typeof portfolioAchievements.$inferSelect;
export type NewPortfolioAchievement = typeof portfolioAchievements.$inferInsert;
