import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Wave 7C opaque keyset cursors for the Resource lists (API Contract v1.6
 * W7C-10). Same wire conventions as the Wave 7A precise cursor (v/k/t/i,
 * base64url JSON, kind-bound, microsecond UTC text timestamp) — kept local
 * because the featured ordering needs one more tuple element (`f`, the
 * featured flag) that the shared strict `{v,k,t,i}` wire shape must not
 * accept for its own kinds.
 *
 * Each kind is bound to exactly one list + sort; a cursor issued by another
 * list or sort decodes to null and is rejected with 422. Cursors are
 * continuation identifiers only, never authorization tokens.
 */
export const RESOURCE_CURSOR_KINDS = {
  /** API-RES-001 sort=recent: publishedAt desc, id desc. */
  publicRecent: "resources-published-recent",
  /** API-RES-001 sort=featured: featured desc, publishedAt desc, id desc. */
  publicFeatured: "resources-published-featured",
  /** API-ADMRES-006 sort=recent: createdAt desc, id desc. */
  adminRecent: "admin-resources-created-at",
} as const;

export type ResourceCursorKind = (typeof RESOURCE_CURSOR_KINDS)[keyof typeof RESOURCE_CURSOR_KINDS];

export interface DecodedResourceCursor {
  /** UTC timestamp with exactly six fractional digits. */
  readonly sortValue: string;
  readonly id: string;
  /** Present only for the featured kind. */
  readonly featured?: boolean;
}

const PRECISE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 512;

const baseWire = {
  v: z.literal(1),
  t: z.string().regex(PRECISE_UTC_TIMESTAMP),
  i: z.uuid(),
};
const featuredWire = z
  .object({ ...baseWire, k: z.literal(RESOURCE_CURSOR_KINDS.publicFeatured), f: z.boolean() })
  .strict();
const plainWire = z
  .object({
    ...baseWire,
    k: z.enum([RESOURCE_CURSOR_KINDS.publicRecent, RESOURCE_CURSOR_KINDS.adminRecent]),
  })
  .strict();

export function encodeResourceCursor(kind: ResourceCursorKind, cursor: DecodedResourceCursor) {
  const payload =
    kind === RESOURCE_CURSOR_KINDS.publicFeatured
      ? { v: 1, k: kind, f: cursor.featured === true, t: cursor.sortValue, i: cursor.id }
      : { v: 1, k: kind, t: cursor.sortValue, i: cursor.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeResourceCursor(
  encoded: string,
  expectedKind: ResourceCursorKind,
): DecodedResourceCursor | null {
  if (!encoded || encoded.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(encoded)) {
    return null;
  }
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return null;
    const raw = JSON.parse(decoded.toString("utf8")) as unknown;
    const schema = expectedKind === RESOURCE_CURSOR_KINDS.publicFeatured ? featuredWire : plainWire;
    const parsed = schema.safeParse(raw);
    if (!parsed.success || parsed.data.k !== expectedKind) return null;
    if (Number.isNaN(Date.parse(parsed.data.t))) return null;
    return "f" in parsed.data
      ? { sortValue: parsed.data.t, id: parsed.data.i, featured: parsed.data.f }
      : { sortValue: parsed.data.t, id: parsed.data.i };
  } catch {
    return null;
  }
}

export const resourceCursorSchema = (kind: ResourceCursorKind) =>
  z
    .string()
    .min(1)
    .max(MAX_CURSOR_LENGTH)
    .transform((value, context) => {
      const decoded = decodeResourceCursor(value, kind);
      if (decoded) return decoded;
      context.addIssue({ code: "custom", message: "Cursor is invalid" });
      return z.NEVER;
    })
    .optional();

/** `(sort, id) < (t, i)` for DESC/DESC orderings (recent lists). */
export function recentContinuation(
  sortColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: DecodedResourceCursor,
): SQL {
  return sql`(${sortColumn}, ${idColumn}) < (${cursor.sortValue}::timestamptz, ${cursor.id}::uuid)`;
}

/** `(featured, publishedAt, id) < (f, t, i)` for the featured ordering (all DESC). */
export function featuredContinuation(
  featuredColumn: AnyColumn,
  sortColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: DecodedResourceCursor,
): SQL {
  return sql`(${featuredColumn}, ${sortColumn}, ${idColumn}) < (${cursor.featured === true}, ${cursor.sortValue}::timestamptz, ${cursor.id}::uuid)`;
}

/** Repositories fetch `limit + 1` rows carrying `cursorSortValue`; the sentinel row is dropped here. */
export function buildResourceCursorPage<
  T extends { cursorSortValue: string; id: string; featured: boolean },
>(rows: readonly T[], limit: number, kind: ResourceCursorKind) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    meta: {
      page: {
        limit,
        nextCursor:
          hasMore && last
            ? encodeResourceCursor(kind, {
                sortValue: last.cursorSortValue,
                id: last.id,
                featured: last.featured,
              })
            : null,
        hasMore,
      },
    },
  };
}
