import { z } from "zod";
import {
  CONSULTING_CURSOR_KINDS,
  type ConsultingCursorKind,
  decodeConsultingCursor,
} from "../pagination/consulting-pagination";

const jsonContainer = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);
const nonEmptyJsonContainer = jsonContainer.refine(
  (value) => (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0),
  "At least one entry is required",
);
const text = z.string().trim().min(1);

export const consultingRequestInputSchema = z
  .object({
    companyDetails: z.record(z.string(), z.unknown()),
    businessSize: text,
    securityConcern: text,
    businessImpact: text.optional(),
    requestedService: z.enum([
      "WEBSITE_ASSESSMENT",
      "NETWORK_ASSESSMENT",
      "VULNERABILITY_ASSESSMENT",
      "PHISHING_AWARENESS",
      "CLOUD_REVIEW",
      "CYBER_RISK_ASSESSMENT",
      "SECURITY_DOCUMENTATION",
    ]),
    environmentDetails: z.record(z.string(), z.unknown()).optional(),
    contactInformation: z.record(z.string(), z.unknown()),
  })
  .strict();

export const scopeAuthorizationInputSchema = z
  .object({
    authorizedTargets: nonEmptyJsonContainer,
    allowedActivities: nonEmptyJsonContainer,
    restrictions: jsonContainer.optional(),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime().optional(),
    attestation: z.literal(true),
  })
  .strict()
  .refine((value) => !value.validUntil || new Date(value.validUntil) >= new Date(value.validFrom), {
    path: ["validUntil"],
    message: "validUntil must not precede validFrom",
  });

export const consultantAssignmentInputSchema = z.object({ consultantUserId: z.uuid() }).strict();
export const transitionInputSchema = z
  .object({ expectedStateVersion: z.number().int().min(1) })
  .strict();
export const reasonTransitionInputSchema = transitionInputSchema.extend({ reason: text }).strict();
export const internalNoteInputSchema = z.object({ body: text }).strict();

export const CONSULTING_DEFAULT_LIMIT = 25;
export const CONSULTING_MAX_LIMIT = 100;
const limitSchema = z.preprocess((value) => {
  if (value === undefined) return CONSULTING_DEFAULT_LIMIT;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value);
  return value;
}, z.number().int().min(1).max(CONSULTING_MAX_LIMIT));

const cursorSchema = (kind: ConsultingCursorKind) =>
  z
    .string()
    .min(1)
    .max(512)
    .transform((value, context) => {
      const decoded = decodeConsultingCursor(value, kind);
      if (decoded) return decoded;
      context.addIssue({ code: "custom", message: "Cursor is invalid" });
      return z.NEVER;
    })
    .optional();

const statusSchema = z.enum([
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "DECLINED",
  "IN_PROGRESS",
  "COMPLETED",
]);

export const businessRequestListQuerySchema = z
  .object({
    status: statusSchema.optional(),
    cursor: cursorSchema(CONSULTING_CURSOR_KINDS.requests),
    limit: limitSchema,
  })
  .strict();
export const operationalRequestListQuerySchema = z
  .object({
    status: statusSchema.optional(),
    employerId: z.uuid().optional(),
    cursor: cursorSchema(CONSULTING_CURSOR_KINDS.requests),
    limit: limitSchema,
  })
  .strict();
export const notesListQuerySchema = z
  .object({ cursor: cursorSchema(CONSULTING_CURSOR_KINDS.notes), limit: limitSchema })
  .strict();

export type ConsultingRequestInput = z.infer<typeof consultingRequestInputSchema>;
export type ScopeAuthorizationInputDto = z.infer<typeof scopeAuthorizationInputSchema>;
export type ConsultantAssignmentInput = z.infer<typeof consultantAssignmentInputSchema>;
export type TransitionInput = z.infer<typeof transitionInputSchema>;
export type ReasonTransitionInput = z.infer<typeof reasonTransitionInputSchema>;
export type InternalNoteInput = z.infer<typeof internalNoteInputSchema>;
export type BusinessRequestListQuery = z.infer<typeof businessRequestListQuerySchema>;
export type OperationalRequestListQuery = z.infer<typeof operationalRequestListQuerySchema>;
export type NotesListQuery = z.infer<typeof notesListQuerySchema>;
