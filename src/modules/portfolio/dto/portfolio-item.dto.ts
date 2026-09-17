import { z } from "zod";

/**
 * Per-item DTOs, one pair (create/update) per §7.12–7.17 child table.
 * Every item shares `isPublic` (per-item consent) and `sortOrder`, exactly
 * as documented; no additional fields (skills, social links, testimonials,
 * badges, etc.) are invented beyond the ERD's own columns.
 */

export const portfolioProjectSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().optional(),
    links: z.array(z.string().trim().min(1)).default([]),
    skills: z.array(z.string().trim().min(1)).default([]),
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export type PortfolioProjectInput = z.infer<typeof portfolioProjectSchema>;
export const portfolioProjectUpdateSchema = portfolioProjectSchema.partial();
export type PortfolioProjectUpdateInput = z.infer<typeof portfolioProjectUpdateSchema>;

export const portfolioLinkSchema = z
  .object({
    url: z.string().trim().min(1, "URL is required"),
    label: z.string().trim().optional(),
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export type PortfolioLinkInput = z.infer<typeof portfolioLinkSchema>;
export const portfolioLinkUpdateSchema = portfolioLinkSchema.partial();
export type PortfolioLinkUpdateInput = z.infer<typeof portfolioLinkUpdateSchema>;

export const portfolioSkillSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export type PortfolioSkillInput = z.infer<typeof portfolioSkillSchema>;
export const portfolioSkillUpdateSchema = portfolioSkillSchema.partial();
export type PortfolioSkillUpdateInput = z.infer<typeof portfolioSkillUpdateSchema>;

export const portfolioCertificationSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    issuer: z.string().trim().optional(),
    credentialUrl: z.string().trim().optional(),
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export type PortfolioCertificationInput = z.infer<typeof portfolioCertificationSchema>;
export const portfolioCertificationUpdateSchema = portfolioCertificationSchema.partial();
export type PortfolioCertificationUpdateInput = z.infer<typeof portfolioCertificationUpdateSchema>;

export const portfolioEvidenceSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().optional(),
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export type PortfolioEvidenceInput = z.infer<typeof portfolioEvidenceSchema>;
export const portfolioEvidenceUpdateSchema = portfolioEvidenceSchema.partial();
export type PortfolioEvidenceUpdateInput = z.infer<typeof portfolioEvidenceUpdateSchema>;

export const portfolioAchievementSchema = z
  .object({
    internshipId: z.uuid().optional(),
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().trim().optional(),
    isPublic: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  })
  .strict();
export type PortfolioAchievementInput = z.infer<typeof portfolioAchievementSchema>;
export const portfolioAchievementUpdateSchema = portfolioAchievementSchema.partial();
export type PortfolioAchievementUpdateInput = z.infer<typeof portfolioAchievementUpdateSchema>;
