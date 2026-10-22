import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Wave 7A opaque cursor for `(timestamp DESC, id DESC)` keyset pagination.
 *
 * Same wire shape as the existing career/consulting cursors (v/k/t/i,
 * base64url JSON, kind-bound), with one deliberate difference: `t` carries
 * the full PostgreSQL microsecond timestamp as text instead of a JS `Date`.
 * `timestamptz` keeps microseconds while `Date` keeps milliseconds, so a
 * Date-based continuation can skip rows that share the boundary row's
 * millisecond. Repositories select the sort column through
 * `preciseTimestampText()` and compare against `t::timestamptz`.
 *
 * Cursors are continuation identifiers only, never authorization tokens.
 */
export const PRECISE_CURSOR_KINDS = {
  auditLogs: "admin-audit-logs-timestamp",
  adminUsers: "admin-users-created-at",
  adminEmployers: "admin-employers-created-at",
} as const;

export type PreciseCursorKind = (typeof PRECISE_CURSOR_KINDS)[keyof typeof PRECISE_CURSOR_KINDS];

export interface DecodedPreciseCursor {
  /** UTC timestamp with exactly six fractional digits, e.g. 2026-10-20T08:00:00.123456Z. */
  readonly sortValue: string;
  readonly id: string;
}

const PRECISE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 512;

const wireSchema = z
  .object({
    v: z.literal(1),
    k: z.enum(PRECISE_CURSOR_KINDS),
    t: z.string().regex(PRECISE_UTC_TIMESTAMP),
    i: z.uuid(),
  })
  .strict();

export function encodePreciseCursor(kind: PreciseCursorKind, cursor: DecodedPreciseCursor) {
  return Buffer.from(
    JSON.stringify({ v: 1, k: kind, t: cursor.sortValue, i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodePreciseCursor(
  encoded: string,
  expectedKind: PreciseCursorKind,
): DecodedPreciseCursor | null {
  if (!encoded || encoded.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(encoded)) {
    return null;
  }
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return null;
    const parsed = wireSchema.safeParse(JSON.parse(decoded.toString("utf8")) as unknown);
    if (!parsed.success || parsed.data.k !== expectedKind) return null;
    if (Number.isNaN(Date.parse(parsed.data.t))) return null;
    return { sortValue: parsed.data.t, id: parsed.data.i };
  } catch {
    return null;
  }
}

export const DEFAULT_PRECISE_LIST_LIMIT = 25;
export const MAX_PRECISE_LIST_LIMIT = 100;

/** API-DEC-006: default 25, maximum 100; out-of-range values are a 422, never silently widened. */
export const preciseLimitSchema = z.preprocess((value) => {
  if (value === undefined) return DEFAULT_PRECISE_LIST_LIMIT;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return Number(value);
  return value;
}, z.number().int().min(1).max(MAX_PRECISE_LIST_LIMIT));

export const preciseCursorSchema = (kind: PreciseCursorKind) =>
  z
    .string()
    .min(1)
    .max(MAX_CURSOR_LENGTH)
    .transform((value, context) => {
      const decoded = decodePreciseCursor(value, kind);
      if (decoded) return decoded;
      context.addIssue({ code: "custom", message: "Cursor is invalid" });
      return z.NEVER;
    })
    .optional();

/** Full-precision UTC text of a `timestamptz` column, matching `PRECISE_UTC_TIMESTAMP`. */
export function preciseTimestampText(column: AnyColumn): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Parameterized `(sort, id) < (cursor.t, cursor.i)` continuation for DESC/DESC ordering. */
export function preciseContinuation(
  sortColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: DecodedPreciseCursor,
): SQL {
  return sql`(${sortColumn} < ${cursor.sortValue}::timestamptz or (${sortColumn} = ${cursor.sortValue}::timestamptz and ${idColumn} < ${cursor.id}::uuid))`;
}

/**
 * Repositories fetch `limit + 1` rows that each carry `cursorSortValue`
 * (the precise text timestamp); the sentinel row is dropped here.
 */
export function buildPreciseCursorPage<T extends { cursorSortValue: string; id: string }>(
  rows: readonly T[],
  limit: number,
  kind: PreciseCursorKind,
) {
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
            ? encodePreciseCursor(kind, { sortValue: last.cursorSortValue, id: last.id })
            : null,
        hasMore,
      },
    },
  };
}
