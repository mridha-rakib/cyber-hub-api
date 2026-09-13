import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "ROLE_LEARNER",
  "ROLE_BUSINESS",
  "ROLE_MENTOR",
  "ROLE_CONSULTANT",
  "ROLE_ADMIN",
]);

export const employerStatus = pgEnum("employer_status", ["ACTIVE", "SUSPENDED", "CLOSED"]);

export const authTokenPurpose = pgEnum("auth_token_purpose", [
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
]);
