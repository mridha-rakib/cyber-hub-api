import { z } from "zod";

/**
 * API-ADM-003 RoleAssignmentInput (API Contract v1.5 §17): `role` only.
 * `.strict()` rejects authVersion, employerId, permissions or any other key
 * (API-AC-023). D7 restrictions (self change, ROLE_BUSINESS, last Admin)
 * depend on stored state and are enforced in the service under row locks.
 */
export const roleAssignmentInputSchema = z
  .object({
    role: z.enum(["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"]),
  })
  .strict();

/**
 * API-ADM-006 UpdateBusinessProfileInput (API Contract v1.5 §17):
 * companyName?, email?, profile?. The contract leaves "allow-listed business
 * profile fields" undefined, so `profile` keeps the same empty strict shape
 * business registration already uses (no key is allow-listed) and is never
 * written. Status, id and ownership are not part of this DTO.
 */
export const employerProfileInputSchema = z
  .object({
    companyName: z.string().trim().min(1, "Company name is required").max(200).optional(),
    email: z.string().trim().max(320).pipe(z.email()).optional(),
    profile: z.object({}).strict().optional(),
  })
  .strict()
  .refine((input) => input.companyName !== undefined || input.email !== undefined, {
    message: "Provide companyName or email",
  });

/** API-ADM-007 EmployerStatusInput (API Contract v1.5 §17). */
export const employerStatusInputSchema = z
  .object({ status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]) })
  .strict();

export type RoleAssignmentInput = z.infer<typeof roleAssignmentInputSchema>;
export type EmployerProfileInput = z.infer<typeof employerProfileInputSchema>;
export type EmployerStatusInput = z.infer<typeof employerStatusInputSchema>;
