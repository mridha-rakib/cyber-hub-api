import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.11 portfolios
 * (Owner: BE-PORT | Basis: FR-LRN-027-035 / RBAC PUB | Release: MVP).
 *
 * "One portfolio root row per learner; child items are normalized tables."
 * Implementation note (verbatim): "Public projection requires root
 * is_public plus per-item is_public. Hidden item metadata is omitted." —
 * i.e. publication is a two-gate AND (root AND item), never either alone.
 */
export const portfolios = pgTable(
  "portfolios",
  {
    ...primaryUuid,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    publicSlug: text("public_slug"),
    isPublic: boolean("is_public").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("portfolios_user_id_key").on(table.userId),
    unique("portfolios_public_slug_key").on(table.publicSlug),
    index("portfolios_is_public_public_slug_idx").on(table.isPublic, table.publicSlug),
  ],
);

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
