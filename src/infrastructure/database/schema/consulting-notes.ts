import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryUuid } from "./common";
import { consultingRequests } from "./consulting-requests";
import { users } from "./users";

/**
 * Database ERD & Data Dictionary v2.0 §7.28 consulting_notes.
 * Internal Consultant/Admin notes are deliberately stored separately from
 * consulting_requests so a Business projection cannot accidentally select
 * them as part of the client-facing request record.
 */
export const consultingNotes = pgTable(
  "consulting_notes",
  {
    ...primaryUuid,
    consultingRequestId: uuid("consulting_request_id")
      .notNull()
      .references(() => consultingRequests.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("consulting_notes_consulting_request_id_idx").on(table.consultingRequestId),
    index("consulting_notes_author_user_id_idx").on(table.authorUserId),
    index("consulting_notes_created_at_idx").on(table.createdAt),
    index("consulting_notes_request_created_desc_idx").on(
      table.consultingRequestId,
      table.createdAt.desc(),
    ),
  ],
);

export type ConsultingNote = typeof consultingNotes.$inferSelect;
export type NewConsultingNote = typeof consultingNotes.$inferInsert;
