import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { courseApprovalStatus } from "./enums";

/** ERD §5: money is numeric(12,2) plus an ISO currency code. */
const moneyColumn = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * Database ERD & Data Dictionary v2.3 §7.8 courses
 * (Owner: BE-CRS | Basis: DR-004 | Release: MVP).
 * "Approved external course-deal catalogue."
 *
 * Persistence only (Wave 7C G2). `approval_status` has no DB default: the
 * service inserts DRAFT explicitly and WF-CRS-02..05 drive every later change
 * (State & Workflow v1.3 §5A.2). `has_affiliate_relationship` is a
 * deliberately nullable declaration with no default — NULL means "not yet
 * declared" and is never treated as false; an APPROVED row must have declared
 * it. `verification_note` and `rejection_reason` are Admin-only (never in
 * public projections). The https CHECK is a prefix guard only; full URL
 * validation (absolute URL, host, no user-info, max length),
 * discounted_price <= original_price and the "not already expired" approval
 * guard stay in the application (ERD §7.8 implementation note).
 * `state_version` follows DB2-DEC-009 (see `resources`).
 */
export const courses = pgTable(
  "courses",
  {
    ...primaryUuid,
    title: text("title").notNull(),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    level: text("level").notNull(),
    originalPrice: moneyColumn("original_price").notNull(),
    discountedPrice: moneyColumn("discounted_price").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    externalUrl: text("external_url").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    affiliateDisclosure: text("affiliate_disclosure"),
    hasAffiliateRelationship: boolean("has_affiliate_relationship"),
    verificationNote: text("verification_note"),
    rejectionReason: text("rejection_reason"),
    approvalStatus: courseApprovalStatus("approval_status").notNull(),
    stateVersion: integer("state_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // ERD v2.3 §9 index list and §7.8 constraints for `courses`, exactly. DESC
  // columns are NULLS FIRST (PostgreSQL's plain DESC) to match `orderBy(desc(...))`.
  (table) => [
    index("courses_approval_status_expires_at_idx").on(table.approvalStatus, table.expiresAt),
    index("courses_category_level_status_idx").on(
      table.category,
      table.level,
      table.approvalStatus,
    ),
    index("courses_provider_status_idx").on(table.provider, table.approvalStatus),
    // Public active and Admin recent cursor (API Contract v1.6 W7C-10).
    index("courses_status_created_at_id_idx").on(
      table.approvalStatus,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check("courses_original_price_check", sql`${table.originalPrice} >= 0`),
    check("courses_discounted_price_check", sql`${table.discountedPrice} >= 0`),
    check("courses_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("courses_external_url_https_check", sql`${table.externalUrl} ~ '^https://'`),
    check(
      "courses_affiliate_disclosure_check",
      sql`${table.hasAffiliateRelationship} IS DISTINCT FROM true OR length(btrim(coalesce(${table.affiliateDisclosure}, ''))) > 0`,
    ),
    check(
      "courses_approved_affiliate_declared_check",
      sql`${table.approvalStatus} <> 'APPROVED' OR ${table.hasAffiliateRelationship} IS NOT NULL`,
    ),
    check(
      "courses_rejected_reason_check",
      sql`${table.approvalStatus} <> 'REJECTED' OR length(btrim(coalesce(${table.rejectionReason}, ''))) > 0`,
    ),
    check(
      "courses_verification_note_length_check",
      sql`${table.verificationNote} IS NULL OR length(${table.verificationNote}) <= 2000`,
    ),
    check(
      "courses_rejection_reason_length_check",
      sql`${table.rejectionReason} IS NULL OR length(${table.rejectionReason}) <= 1000`,
    ),
    check("courses_state_version_check", sql`${table.stateVersion} >= 1`),
  ],
);

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
