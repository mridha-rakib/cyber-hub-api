import { z } from "zod";

const profileSchema = z.object({}).strict().optional();

export const registerBusinessSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email(),
    password: z.string().min(8).max(256),
    companyName: z.string().trim().min(1, "Company name is required"),
    businessEmail: z.string().trim().email(),
    userProfile: profileSchema,
    businessProfile: profileSchema,
  })
  .strict();

export type RegisterBusinessInput = z.infer<typeof registerBusinessSchema>;
