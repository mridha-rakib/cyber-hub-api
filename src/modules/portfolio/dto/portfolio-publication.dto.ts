import { z } from "zod";

/** API Contract v1.1 `PortfolioPublicationInput` (API-PORT-003). */
export const portfolioPublicationSchema = z
  .object({
    isPublic: z.boolean(),
    publicSlug: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only")
      .optional(),
  })
  .strict();

export type PortfolioPublicationInput = z.infer<typeof portfolioPublicationSchema>;
