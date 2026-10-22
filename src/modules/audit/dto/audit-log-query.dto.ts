import { z } from "zod";
import {
  PRECISE_CURSOR_KINDS,
  preciseCursorSchema,
  preciseLimitSchema,
} from "../../../common/pagination/precise-timestamp-cursor";

const filterText = z.string().trim().min(1).max(200);

/**
 * API-AUD-001 query (API Contract v1.5 AUD group): actorUserId?, action?,
 * entityType?, entityId?, employerId?, from?, to?, cursor?, limit?.
 * `.strict()` rejects any other key (API-AC-024) — there is no sort
 * parameter; ordering is always timestamp DESC, id DESC. `from`/`to` are
 * inclusive ISO-8601 instants and `from` may not be after `to`.
 */
export const auditLogListQuerySchema = z
  .object({
    actorUserId: z.uuid().optional(),
    action: filterText.optional(),
    entityType: filterText.optional(),
    entityId: z.uuid().optional(),
    employerId: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: preciseCursorSchema(PRECISE_CURSOR_KINDS.auditLogs),
    limit: preciseLimitSchema,
  })
  .strict()
  .refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
    message: "from must not be after to",
    path: ["from"],
  });

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
