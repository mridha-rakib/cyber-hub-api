import { relations } from "drizzle-orm";
import { auditLogs } from "./audit-logs";
import { authTokens } from "./auth-tokens";
import { employers } from "./employers";
import { sessions } from "./sessions";
import { users } from "./users";

export const employersRelations = relations(employers, ({ many }) => ({
  users: many(users),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  employer: one(employers, {
    fields: [users.employerId],
    references: [employers.id],
  }),
  sessions: many(sessions),
  authTokens: many(authTokens),
  actorAuditLogs: many(auditLogs, { relationName: "auditLogActor" }),
  subjectAuditLogs: many(auditLogs, { relationName: "auditLogSubject" }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, {
    fields: [authTokens.userId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id],
    relationName: "auditLogActor",
  }),
  subject: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
    relationName: "auditLogSubject",
  }),
  employer: one(employers, {
    fields: [auditLogs.employerId],
    references: [employers.id],
  }),
}));
