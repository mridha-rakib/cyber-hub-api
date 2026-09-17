import { z } from "zod";

/** API Contract v1.1 `TaskWriteInput`. */
export const taskWriteSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().min(1, "Description is required"),
    orderNo: z.number().int().min(0),
    requirements: z.record(z.string(), z.unknown()),
  })
  .strict();

export type TaskWriteInput = z.infer<typeof taskWriteSchema>;

export const taskUpdateSchema = taskWriteSchema.partial();

export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
