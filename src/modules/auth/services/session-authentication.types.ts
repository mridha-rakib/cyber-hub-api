import type { User } from "../../../infrastructure/database/schema";

/**
 * The safe subset of the `users` row a principal may carry downstream.
 * Deliberately excludes `passwordHash` (and any other future secret
 * column) at the type level, so `@CurrentUser()` consumers cannot
 * accidentally serialize a credential by returning `principal.user`
 * directly — see Wave 0D-1's AuthPrincipal hardening finding.
 */
export type SafeUser = Omit<User, "passwordHash">;

export interface AuthPrincipal {
  sessionId: string;
  userId: string;
  role: User["role"];
  employerId?: string;
  user: SafeUser;
}
