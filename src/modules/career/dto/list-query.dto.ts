import { z } from "zod";
import {
  CAREER_CURSOR_KINDS,
  type CareerCursorKind,
  decodeCareerCursor,
} from "../pagination/cursor-pagination";

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 100;

const listingTypeSchema = z.enum(["JOB", "INTERNSHIP", "GRADUATE_ROLE", "APPRENTICESHIP"]);
const opportunityTypeSchema = z.enum(["INTERNSHIP_OPPORTUNITY", "STUDENT_PROJECT"]);
const listingStatusSchema = z.enum([
  "SUBMITTED",
  "UNDER_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "CLOSED",
]);

const optionalTextFilterSchema = z.string().trim().optional();

const limitSchema = z.preprocess((value) => {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return Number(value);
  return value;
}, z.number().int().min(1).max(MAX_LIST_LIMIT));

const cursorSchema = (kind: CareerCursorKind) =>
  z
    .string()
    .min(1)
    .max(512)
    .transform((value, context) => {
      const decoded = decodeCareerCursor(value, kind);
      if (decoded) return decoded;

      context.addIssue({
        code: "custom",
        message: "Cursor is invalid",
      });
      return z.NEVER;
    })
    .optional();

export const publicCareerListQuerySchema = z
  .object({
    type: listingTypeSchema.optional(),
    location: optionalTextFilterSchema,
    level: optionalTextFilterSchema,
    skill: optionalTextFilterSchema,
    remoteUk: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    cursor: cursorSchema(CAREER_CURSOR_KINDS.jobPublished),
    limit: limitSchema,
  })
  .strict();

export const ownCareerListQuerySchema = z
  .object({
    status: listingStatusSchema.optional(),
    cursor: cursorSchema(CAREER_CURSOR_KINDS.jobCreated),
    limit: limitSchema,
  })
  .strict();

export const adminCareerListQuerySchema = z
  .object({
    status: listingStatusSchema.optional(),
    employerId: z.uuid().optional(),
    type: listingTypeSchema.optional(),
    cursor: cursorSchema(CAREER_CURSOR_KINDS.jobCreated),
    limit: limitSchema,
  })
  .strict();

export const publicOpportunityListQuerySchema = z
  .object({
    type: opportunityTypeSchema.optional(),
    skill: optionalTextFilterSchema,
    cursor: cursorSchema(CAREER_CURSOR_KINDS.opportunityPublished),
    limit: limitSchema,
  })
  .strict();

export const ownOpportunityListQuerySchema = z
  .object({
    type: opportunityTypeSchema.optional(),
    status: listingStatusSchema.optional(),
    cursor: cursorSchema(CAREER_CURSOR_KINDS.opportunityCreated),
    limit: limitSchema,
  })
  .strict();

export const adminOpportunityListQuerySchema = z
  .object({
    status: listingStatusSchema.optional(),
    employerId: z.uuid().optional(),
    type: opportunityTypeSchema.optional(),
    cursor: cursorSchema(CAREER_CURSOR_KINDS.opportunityCreated),
    limit: limitSchema,
  })
  .strict();

export type PublicCareerListQuery = z.infer<typeof publicCareerListQuerySchema>;
export type OwnCareerListQuery = z.infer<typeof ownCareerListQuerySchema>;
export type AdminCareerListQuery = z.infer<typeof adminCareerListQuerySchema>;
export type PublicOpportunityListQuery = z.infer<typeof publicOpportunityListQuerySchema>;
export type OwnOpportunityListQuery = z.infer<typeof ownOpportunityListQuerySchema>;
export type AdminOpportunityListQuery = z.infer<typeof adminOpportunityListQuerySchema>;
