import { z } from "zod";

/**
 * API Contract v1.1 `EmployerOpportunityInput` (§9 DTO tables):
 * type/title/description required; requirements/skills/applicationUrl
 * optional. "Ownership/status/moderation fields are server-owned."
 */
export const employerOpportunityInputSchema = z
  .object({
    type: z.enum(["INTERNSHIP_OPPORTUNITY", "STUDENT_PROJECT"]),
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().min(1, "Description is required"),
    requirements: z.record(z.string(), z.unknown()).optional(),
    skills: z.array(z.string().trim().min(1)).optional(),
    applicationUrl: z.string().trim().url("Application URL must be a valid URL").optional(),
  })
  .strict();

export type EmployerOpportunityInput = z.infer<typeof employerOpportunityInputSchema>;

/** PATCH (API-BIZOPP-004) allows any subset of the same fields, REJECTED-state only. */
export const employerOpportunityUpdateSchema = employerOpportunityInputSchema.partial().extend({
  expectedStateVersion: z.number().int().min(1),
});

export type EmployerOpportunityUpdateInput = z.infer<typeof employerOpportunityUpdateSchema>;
