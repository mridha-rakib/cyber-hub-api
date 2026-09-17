import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { portfolios } from "./portfolios";

/** Database ERD & Data Dictionary v2.0 §7.12 portfolio_projects. */
export const portfolioProjects = pgTable(
  "portfolio_projects",
  {
    ...primaryUuid,
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id),
    title: text("title").notNull(),
    description: text("description"),
    links: text("links").array().notNull().default([]),
    skills: text("skills").array().notNull().default([]),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("portfolio_projects_portfolio_id_sort_order_idx").on(table.portfolioId, table.sortOrder),
    index("portfolio_projects_portfolio_id_is_public_idx").on(table.portfolioId, table.isPublic),
    index("portfolio_projects_skills_gin_idx").using("gin", table.skills),
  ],
);

export type PortfolioProject = typeof portfolioProjects.$inferSelect;
export type NewPortfolioProject = typeof portfolioProjects.$inferInsert;
