import { z } from "zod";

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8).max(256),
  })
  .strict();

export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
