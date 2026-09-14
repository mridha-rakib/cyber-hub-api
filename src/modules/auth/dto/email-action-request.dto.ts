import { z } from "zod";

export const emailActionRequestSchema = z
  .object({
    email: z.string().trim().email(),
  })
  .strict();

export type EmailActionRequestInput = z.infer<typeof emailActionRequestSchema>;
