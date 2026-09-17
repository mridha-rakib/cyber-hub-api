import { z } from "zod";

/**
 * API Contract v1.1 `InternshipWriteInput` (§9 DTO tables). `requirements`
 * and `duration` are documented only as "object" with "source-limited"
 * (no further leaf schema defined) — accepted as opaque JSON objects rather
 * than inventing a sub-shape. `status`/`stateVersion`/timestamps are
 * server-owned and never accepted here.
 */
export const internshipWriteSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().min(1, "Description is required"),
    requirements: z.record(z.string(), z.unknown()),
    duration: z.record(z.string(), z.unknown()),
    completionCriteria: z.array(z.unknown()),
  })
  .strict();

export type InternshipWriteInput = z.infer<typeof internshipWriteSchema>;

/** PATCH allows any subset of the same fields. */
export const internshipUpdateSchema = internshipWriteSchema.partial().extend({
  expectedStateVersion: z.number().int().min(1),
});

export type InternshipUpdateInput = z.infer<typeof internshipUpdateSchema>;
