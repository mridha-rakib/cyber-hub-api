import { z } from "zod";
import {
  PRECISE_CURSOR_KINDS,
  preciseCursorSchema,
  preciseLimitSchema,
} from "../../../common/pagination/precise-timestamp-cursor";

/** API-ADM-001 query (API Contract v1.5 ADM group): role?, verified?, cursor?, limit?. */
export const adminUserListQuerySchema = z
  .object({
    role: z
      .enum(["ROLE_LEARNER", "ROLE_BUSINESS", "ROLE_MENTOR", "ROLE_CONSULTANT", "ROLE_ADMIN"])
      .optional(),
    verified: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    cursor: preciseCursorSchema(PRECISE_CURSOR_KINDS.adminUsers),
    limit: preciseLimitSchema,
  })
  .strict();

/** API-ADM-004 query (API Contract v1.5 ADM group): status?, cursor?, limit?. */
export const adminEmployerListQuerySchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
    cursor: preciseCursorSchema(PRECISE_CURSOR_KINDS.adminEmployers),
    limit: preciseLimitSchema,
  })
  .strict();

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type AdminEmployerListQuery = z.infer<typeof adminEmployerListQuerySchema>;
