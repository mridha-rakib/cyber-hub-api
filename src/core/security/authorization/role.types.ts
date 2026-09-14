import { userRole } from "../../../infrastructure/database/schema/enums";

/**
 * The 5 authenticated RBAC roles, derived from the Drizzle `user_role`
 * pgEnum (the single source of truth) rather than duplicated by hand, so
 * the application-layer type can never drift from the database enum.
 *
 * Visitor/public access is a route classification (see route-classification
 * decorators), never a 6th authenticated role.
 */
export const ROLES = userRole.enumValues;

export type Role = (typeof userRole.enumValues)[number];

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);
