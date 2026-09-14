import { z } from "zod";

export const tokenConfirmSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();

export type TokenConfirmInput = z.infer<typeof tokenConfirmSchema>;
