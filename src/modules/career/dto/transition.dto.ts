import { z } from "zod";

/**
 * API Contract v1.1 `TransitionInput` — every named workflow transition
 * command takes only `expectedStateVersion`. "Named endpoint determines
 * target state; client never sends target status."
 */
export const transitionSchema = z
  .object({
    expectedStateVersion: z.number().int().min(1),
  })
  .strict();

export type TransitionInput = z.infer<typeof transitionSchema>;

/** `ReasonTransitionInput` — used by the reject transition. */
export const reasonTransitionSchema = z
  .object({
    expectedStateVersion: z.number().int().min(1),
    reason: z.string().trim().min(1, "Reason is required"),
  })
  .strict();

export type ReasonTransitionInput = z.infer<typeof reasonTransitionSchema>;
