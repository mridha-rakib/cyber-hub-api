import type { User } from "../../../infrastructure/database/schema";

export interface AuthPrincipal {
  sessionId: string;
  userId: string;
  role: User["role"];
  employerId?: string;
  user: User;
}
