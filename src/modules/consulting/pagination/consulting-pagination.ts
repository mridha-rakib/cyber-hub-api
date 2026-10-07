import { z } from "zod";

export const CONSULTING_CURSOR_KINDS = {
  requests: "consulting-requests-submitted-at",
  notes: "consulting-notes-created-at",
} as const;

export type ConsultingCursorKind =
  (typeof CONSULTING_CURSOR_KINDS)[keyof typeof CONSULTING_CURSOR_KINDS];

export interface DecodedConsultingCursor {
  readonly sortValue: Date;
  readonly id: string;
}

const wireSchema = z
  .object({
    v: z.literal(1),
    k: z.enum(CONSULTING_CURSOR_KINDS),
    t: z.iso.datetime(),
    i: z.uuid(),
  })
  .strict();

export function decodeConsultingCursor(
  encoded: string,
  expectedKind: ConsultingCursorKind,
): DecodedConsultingCursor | null {
  if (!encoded || encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return null;
    const parsed = wireSchema.safeParse(JSON.parse(decoded.toString("utf8")) as unknown);
    if (!parsed.success || parsed.data.k !== expectedKind) return null;
    return { sortValue: new Date(parsed.data.t), id: parsed.data.i };
  } catch {
    return null;
  }
}

function encodeConsultingCursor(
  kind: ConsultingCursorKind,
  cursor: DecodedConsultingCursor,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, k: kind, t: cursor.sortValue.toISOString(), i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function buildConsultingCursorPage<T>(
  rows: readonly T[],
  limit: number,
  kind: ConsultingCursorKind,
  getSortValue: (row: T) => Date,
  getId: (row: T) => string,
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
            ? encodeConsultingCursor(kind, { sortValue: getSortValue(last), id: getId(last) })
            : null,
        hasMore,
      },
    },
  };
}
