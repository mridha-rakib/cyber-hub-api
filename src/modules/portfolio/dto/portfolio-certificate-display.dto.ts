import { z } from "zod";

/** API Contract v1.1 `PortfolioCertificateDisplayInput` (API-PORT-022/023). */
export const portfolioCertificateDisplaySchema = z
  .object({
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();

export type PortfolioCertificateDisplayInput = z.infer<typeof portfolioCertificateDisplaySchema>;

export const portfolioCertificateDisplayUpdateSchema = portfolioCertificateDisplaySchema.partial();
export type PortfolioCertificateDisplayUpdateInput = z.infer<
  typeof portfolioCertificateDisplayUpdateSchema
>;
