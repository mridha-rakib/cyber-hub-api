import { z } from "zod";

/**
 * API Contract v1.1 `BusinessCareerListingInput` (§9 DTO tables):
 * title/location/level/skills/applicationUrl/listingType required,
 * remoteUk optional (default false). "employerId/submittedBy/status/
 * stateVersion/publishedAt are server-owned. Employer display name comes
 * from ORG profile." — none of those five fields, nor `employerName`
 * itself, are ever accepted from the request body.
 */
export const businessCareerListingInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    location: z.string().trim().min(1, "Location is required"),
    level: z.string().trim().min(1, "Level is required"),
    skills: z.array(z.string().trim().min(1)),
    applicationUrl: z.string().trim().url("Application URL must be a valid URL"),
    listingType: z.enum(["JOB", "INTERNSHIP", "GRADUATE_ROLE", "APPRENTICESHIP"]),
    remoteUk: z.boolean().optional(),
  })
  .strict();

export type BusinessCareerListingInput = z.infer<typeof businessCareerListingInputSchema>;

/** PATCH (API-BIZCAR-004) allows any subset of the same fields, REJECTED-state only. */
export const businessCareerListingUpdateSchema = businessCareerListingInputSchema.partial().extend({
  expectedStateVersion: z.number().int().min(1),
});

export type BusinessCareerListingUpdateInput = z.infer<typeof businessCareerListingUpdateSchema>;
