import { z } from "zod";

/** API Contract v1.1 `TaskAssignmentInput`. */
export const taskAssignmentInputSchema = z
  .object({
    taskIds: z.array(z.uuid()).min(1, "At least one task is required"),
    dueAtByTask: z.record(z.string(), z.iso.datetime()).optional(),
  })
  .strict();

export type TaskAssignmentInput = z.infer<typeof taskAssignmentInputSchema>;
