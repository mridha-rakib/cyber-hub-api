import { z } from "zod";
import { preciseLimitSchema } from "../../../common/pagination/precise-timestamp-cursor";
import {
  RESOURCE_CURSOR_KINDS,
  type ResourceCursorKind,
  resourceCursorSchema,
} from "../pagination/resource-cursor";

/**
 * API Contract v1.6 §17 `ResourceWriteInput` + W7C-11 (ERD v2.3 §7.5).
 *
 * Lengths are counted after trimming in UTF-16 code units (JavaScript string
 * length); `z.string().trim()` runs before `min`/`max`, exactly like the
 * existing DTOs. Content is plain text — it is never interpreted as HTML or
 * Markdown — and its link URLs are stored as given after validation (direct
 * links; there is no resource redirect operation, W7C-7).
 */

// U+0000-U+0008, U+000B, U+000C, U+000E-U+001F, U+007F. Tab, LF and CR stay allowed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the contract's forbidden control characters
const FORBIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noControlCharacters = (value: string) => !FORBIDDEN_CONTROL_CHARACTERS.test(value);
const CONTROL_MESSAGE = "Contains a disallowed control character";

const MAX_STATE_VERSION = 2147483647;

/**
 * Upper bound in UTF-16 code units (JavaScript string length), as the contract
 * requires. Zod 4's own `.max()` counts Unicode code points instead (an astral
 * character counts once there, twice here), so it is deliberately not used.
 */
const maxUtf16 = (max: number) => (value: string) => value.length <= max;

/** Trimmed plain text, 1..max UTF-16 code units, no disallowed control characters. */
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(maxUtf16(max), `At most ${max} UTF-16 code units`)
    .refine(noControlCharacters, CONTROL_MESSAGE);

/** Absolute https URL with a host and no user-info, at most 2048 characters (W7C-7). */
const httpsUrl = z
  .string()
  .trim()
  .min(1)
  .refine(maxUtf16(2048), "At most 2048 UTF-16 code units")
  .refine(noControlCharacters, CONTROL_MESSAGE)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname.length > 0 &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }, "Must be an absolute https URL with a host and no embedded credentials");

const resourceLinkSchema = z.object({ label: plainText(120), url: httpsUrl }).strict();

export const resourceContentSchema = z
  .object({
    summary: plainText(500),
    body: plainText(20000),
    links: z.array(resourceLinkSchema).max(10).optional(),
  })
  .strict();

/** At most 20 tags, each trimmed to 1..50; duplicates removed by case-sensitive exact match. */
const tagsSchema = z
  .array(plainText(50))
  .max(20)
  .transform((tags) => [...new Set(tags)]);

const expectedStateVersionSchema = z.number().int().min(1).max(MAX_STATE_VERSION);

/** API-ADMRES-001. status/publishedAt/stateVersion/timestamps are server-owned. */
export const resourceCreateSchema = z
  .object({
    title: plainText(200),
    category: plainText(100),
    tags: tagsSchema,
    content: resourceContentSchema,
    featured: z.boolean().optional(),
  })
  .strict();

export type ResourceCreateInput = z.infer<typeof resourceCreateSchema>;

/** API-ADMRES-002: Partial ResourceWriteInput + expectedStateVersion; at least one field changes. */
export const resourceUpdateSchema = z
  .object({
    title: plainText(200).optional(),
    category: plainText(100).optional(),
    tags: tagsSchema.optional(),
    content: resourceContentSchema.optional(),
    featured: z.boolean().optional(),
    expectedStateVersion: expectedStateVersionSchema,
  })
  .strict()
  .refine(
    ({ expectedStateVersion: _version, ...fields }) =>
      Object.values(fields).some((value) => value !== undefined),
    "At least one field must be provided",
  );

export type ResourceUpdateInput = z.infer<typeof resourceUpdateSchema>;

/** API-ADMRES-003/004 `TransitionInput`. */
export const resourceTransitionSchema = z
  .object({ expectedStateVersion: expectedStateVersionSchema })
  .strict();

export type ResourceTransitionInput = z.infer<typeof resourceTransitionSchema>;

/**
 * API-ADMRES-005 (W7C-12): `expectedStateVersion` is a query parameter — a
 * decimal integer 1..2147483647 without sign, fraction or leading zeros,
 * supplied exactly once (a repeated key arrives as an array and fails the
 * string check). Any other query key is rejected.
 */
export const resourceDeleteQuerySchema = z
  .object({
    expectedStateVersion: z
      .string()
      .regex(/^[1-9][0-9]{0,9}$/, "Must be a positive decimal integer")
      .transform(Number)
      .refine((value) => value <= MAX_STATE_VERSION, "Out of range"),
  })
  .strict();

export type ResourceDeleteQuery = z.infer<typeof resourceDeleteQuerySchema>;

/** DELETE carries no body (W7C-12): absent or an empty JSON object only. */
export const resourceDeleteBodySchema = z.union([z.undefined(), z.object({}).strict()]);

const booleanQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const listFilters = {
  q: plainText(100).optional(),
  category: plainText(100).optional(),
  tag: plainText(50).optional(),
  featured: booleanQuery,
  limit: preciseLimitSchema,
};

/**
 * API-RES-001: `sort` is recent (default) or featured; the cursor must have
 * been issued by the same list and sort (kind-bound), otherwise 422.
 */
export const publicResourceListQuerySchema = z
  .object({
    ...listFilters,
    sort: z.enum(["recent", "featured"]).default("recent"),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict()
  .transform((query, context) => {
    const kind: ResourceCursorKind =
      query.sort === "featured"
        ? RESOURCE_CURSOR_KINDS.publicFeatured
        : RESOURCE_CURSOR_KINDS.publicRecent;
    if (query.cursor === undefined) return { ...query, cursor: undefined, kind };
    const parsed = resourceCursorSchema(kind).safeParse(query.cursor);
    if (!parsed.success || !parsed.data) {
      context.addIssue({ code: "custom", path: ["cursor"], message: "Cursor is invalid" });
      return z.NEVER;
    }
    return { ...query, cursor: parsed.data, kind };
  });

export type PublicResourceListQuery = z.infer<typeof publicResourceListQuerySchema>;

/** API-ADMRES-006: every lifecycle state; sort recent only (createdAt desc, id desc). */
export const adminResourceListQuerySchema = z
  .object({
    ...listFilters,
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
    sort: z.enum(["recent"]).default("recent"),
    cursor: resourceCursorSchema(RESOURCE_CURSOR_KINDS.adminRecent),
  })
  .strict();

export type AdminResourceListQuery = z.infer<typeof adminResourceListQuerySchema>;
