import { z } from "zod";

/**
 * Wave 0D-6 Phase 19. Reusable stateVersion validation for any future
 * workflow-command DTO. Not wired to a controller yet (no product module
 * exists for consulting requests/assessments) — exercised directly by
 * `transition-command.schema.spec.ts` per Phase 19's "test command/service
 * boundary directly" instruction, ready for a future controller to import
 * as-is.
 *
 * Versions begin at 1 (see `state_version` column defaults). Rejects zero,
 * negative, non-integer, NaN and non-numeric input — never silently
 * coerces a string.
 */
export const expectedStateVersionSchema = z.number().int().min(1);

export const transitionCommandSchema = z
  .object({
    expectedStateVersion: expectedStateVersionSchema,
  })
  .strict();

export type TransitionCommandInput = z.infer<typeof transitionCommandSchema>;
