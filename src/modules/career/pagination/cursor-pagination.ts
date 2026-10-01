import { z } from "zod";

export const CAREER_CURSOR_KINDS = {
  jobPublished: "job-published-at",
  jobCreated: "job-created-at",
  opportunityPublished: "opportunity-published-at",
  opportunityCreated: "opportunity-created-at",
} as const;

export type CareerCursorKind = (typeof CAREER_CURSOR_KINDS)[keyof typeof CAREER_CURSOR_KINDS];

export interface DecodedCareerCursor {
  readonly sortValue: Date;
  readonly id: string;
}

interface CursorWirePayload {
  readonly v: 1;
  readonly k: CareerCursorKind;
  readonly t: string;
  readonly i: string;
}

const cursorWireSchema = z
  .object({
    v: z.literal(1),
    k: z.enum(CAREER_CURSOR_KINDS),
    t: z.iso.datetime(),
    i: z.uuid(),
  })
  .strict();

const MAX_CURSOR_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Cursor payloads contain only the allow-listed ordering tuple. They are
 * opaque continuation identifiers, not authorization tokens: every query
 * still applies its independent PUB/ORG/Admin predicates.
 */
export function encodeCareerCursor(kind: CareerCursorKind, cursor: DecodedCareerCursor): string {
  const payload: CursorWirePayload = {
    v: 1,
    k: kind,
    t: cursor.sortValue.toISOString(),
    i: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCareerCursor(
  encoded: string,
  expectedKind: CareerCursorKind,
): DecodedCareerCursor | null {
  if (
    encoded.length === 0 ||
    encoded.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(encoded)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return null;

    const parsedJson: unknown = JSON.parse(decoded.toString("utf8"));
    const parsed = cursorWireSchema.safeParse(parsedJson);
    if (!parsed.success || parsed.data.k !== expectedKind) return null;

    return {
      sortValue: new Date(parsed.data.t),
      id: parsed.data.i,
    };
  } catch {
    return null;
  }
}

export interface CursorPageMeta {
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export interface CursorPage<T> {
  readonly data: T[];
  readonly meta: CursorPageMeta;
}

/**
 * Repositories fetch `limit + 1`; this helper removes the sentinel row and
 * derives the next opaque cursor from the final row actually returned.
 */
export function buildCursorPage<T>(
  rows: readonly T[],
  limit: number,
  kind: CareerCursorKind,
  getSortValue: (row: T) => Date | null,
  getId: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  let nextCursor: string | null = null;

  if (hasMore && last) {
    const sortValue = getSortValue(last);
    if (!sortValue) {
      throw new Error("Paginated published record is missing its ordering timestamp");
    }
    nextCursor = encodeCareerCursor(kind, { sortValue, id: getId(last) });
  }

  return {
    data,
    meta: {
      page: {
        limit,
        nextCursor,
        hasMore,
      },
    },
  };
}
