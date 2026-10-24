import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { contentStatus } from "./enums";

/**
 * Database ERD & Data Dictionary v2.3 §7.5 resources
 * (Owner: BE-RES | Basis: DR-003 | Release: MVP).
 * "Learning resource catalogue and admin-managed content."
 *
 * Persistence only (Wave 7C G2). `content` is the plain-text object
 * { summary, body, links? } whose keys, lengths (trimmed, UTF-16 code units)
 * and https-link rules are enforced by the application (ERD §7.5
 * implementation note; API Contract v1.6 W7C-11) — the column itself stays a
 * plain jsonb. `status` has no DB default: the service inserts DRAFT
 * explicitly and WF-RES-02..04 drive every later change. `state_version`
 * is the DB2-DEC-009 token: every edit/transition is a conditional UPDATE on
 * id + permitted status + expected version that increments it; deletion
 * (DRAFT only) checks it without incrementing (ERD §10).
 */
export const resources = pgTable(
  "resources",
  {
    ...primaryUuid,
    title: text("title").notNull(),
    category: text("category").notNull(),
    tags: text("tags").array().notNull(),
    content: jsonb("content").notNull(),
    status: contentStatus("status").notNull(),
    featured: boolean("featured").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    stateVersion: integer("state_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // ERD v2.3 §9 index list for `resources`, exactly. DESC columns are
  // NULLS FIRST (PostgreSQL's plain DESC) so they match `orderBy(desc(...))`.
  (table) => [
    index("resources_status_published_at_idx").on(
      table.status,
      table.publishedAt.desc().nullsFirst(),
    ),
    index("resources_category_status_idx").on(table.category, table.status),
    index("resources_tags_gin_idx").using("gin", table.tags),
    index("resources_featured_status_idx").on(table.featured, table.status),
    // Featured-first public cursor (API Contract v1.6 W7C-10).
    index("resources_status_featured_published_id_idx").on(
      table.status,
      table.featured.desc().nullsFirst(),
      table.publishedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // Admin management cursor (recent = created_at desc, id desc).
    index("resources_created_at_id_idx").on(
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check("resources_state_version_check", sql`${table.stateVersion} >= 1`),
  ],
);

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
