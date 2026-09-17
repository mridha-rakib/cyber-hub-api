import { relations } from "drizzle-orm";
import { auditLogs } from "./audit-logs";
import { authTokens } from "./auth-tokens";
import { consultingRequests } from "./consulting-requests";
import { employers } from "./employers";
import { internshipApplications } from "./internship-applications";
import { internshipEnrollments } from "./internship-enrollments";
import { internships } from "./internships";
import { securityAssessments } from "./security-assessments";
import { securityScopeAuthorizations } from "./security-scope-authorizations";
import { sessions } from "./sessions";
import { submissionVersions } from "./submission-versions";
import { submissions } from "./submissions";
import { taskAssignments } from "./task-assignments";
import { tasks } from "./tasks";
import { users } from "./users";

export const employersRelations = relations(employers, ({ many }) => ({
  users: many(users),
  auditLogs: many(auditLogs),
  consultingRequests: many(consultingRequests),
  securityScopeAuthorizations: many(securityScopeAuthorizations),
  securityAssessments: many(securityAssessments),
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
  submittedConsultingRequests: many(consultingRequests, {
    relationName: "consultingRequestSubmitter",
  }),
  assignedConsultingRequests: many(consultingRequests, {
    relationName: "consultingRequestAssignedConsultant",
  }),
  confirmedScopeAuthorizations: many(securityScopeAuthorizations),
  assignedSecurityAssessments: many(securityAssessments),
}));

export const consultingRequestsRelations = relations(consultingRequests, ({ one, many }) => ({
  employer: one(employers, {
    fields: [consultingRequests.employerId],
    references: [employers.id],
  }),
  submittedByUser: one(users, {
    fields: [consultingRequests.submittedByUserId],
    references: [users.id],
    relationName: "consultingRequestSubmitter",
  }),
  assignedConsultant: one(users, {
    fields: [consultingRequests.assignedConsultantId],
    references: [users.id],
    relationName: "consultingRequestAssignedConsultant",
  }),
  scopeAuthorizations: many(securityScopeAuthorizations),
  assessments: many(securityAssessments),
}));

export const securityScopeAuthorizationsRelations = relations(
  securityScopeAuthorizations,
  ({ one, many }) => ({
    consultingRequest: one(consultingRequests, {
      fields: [securityScopeAuthorizations.consultingRequestId],
      references: [consultingRequests.id],
    }),
    employer: one(employers, {
      fields: [securityScopeAuthorizations.employerId],
      references: [employers.id],
    }),
    confirmedByUser: one(users, {
      fields: [securityScopeAuthorizations.confirmedByUserId],
      references: [users.id],
    }),
    assessments: many(securityAssessments),
  }),
);

export const securityAssessmentsRelations = relations(securityAssessments, ({ one }) => ({
  employer: one(employers, {
    fields: [securityAssessments.employerId],
    references: [employers.id],
  }),
  consultingRequest: one(consultingRequests, {
    fields: [securityAssessments.consultingRequestId],
    references: [consultingRequests.id],
  }),
  scopeAuthorization: one(securityScopeAuthorizations, {
    fields: [securityAssessments.scopeAuthorizationId],
    references: [securityScopeAuthorizations.id],
  }),
  assignedConsultant: one(users, {
    fields: [securityAssessments.assignedConsultantId],
    references: [users.id],
  }),
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

export const internshipsRelations = relations(internships, ({ many }) => ({
  applications: many(internshipApplications),
  enrollments: many(internshipEnrollments),
  tasks: many(tasks),
}));

export const internshipApplicationsRelations = relations(internshipApplications, ({ one }) => ({
  internship: one(internships, {
    fields: [internshipApplications.internshipId],
    references: [internships.id],
  }),
  user: one(users, {
    fields: [internshipApplications.userId],
    references: [users.id],
    relationName: "internshipApplicationApplicant",
  }),
  reviewer: one(users, {
    fields: [internshipApplications.reviewerId],
    references: [users.id],
    relationName: "internshipApplicationReviewer",
  }),
}));

export const internshipEnrollmentsRelations = relations(internshipEnrollments, ({ one, many }) => ({
  application: one(internshipApplications, {
    fields: [internshipEnrollments.applicationId],
    references: [internshipApplications.id],
  }),
  internship: one(internships, {
    fields: [internshipEnrollments.internshipId],
    references: [internships.id],
  }),
  user: one(users, {
    fields: [internshipEnrollments.userId],
    references: [users.id],
  }),
  taskAssignments: many(taskAssignments),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  internship: one(internships, {
    fields: [tasks.internshipId],
    references: [internships.id],
  }),
  assignments: many(taskAssignments),
}));

export const taskAssignmentsRelations = relations(taskAssignments, ({ one, many }) => ({
  enrollment: one(internshipEnrollments, {
    fields: [taskAssignments.enrollmentId],
    references: [internshipEnrollments.id],
  }),
  task: one(tasks, {
    fields: [taskAssignments.taskId],
    references: [tasks.id],
  }),
  assignedByUser: one(users, {
    fields: [taskAssignments.assignedByUserId],
    references: [users.id],
  }),
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  task: one(tasks, {
    fields: [submissions.taskId],
    references: [tasks.id],
  }),
  taskAssignment: one(taskAssignments, {
    fields: [submissions.taskAssignmentId],
    references: [taskAssignments.id],
  }),
  user: one(users, {
    fields: [submissions.userId],
    references: [users.id],
    relationName: "submissionOwner",
  }),
  reviewer: one(users, {
    fields: [submissions.reviewerId],
    references: [users.id],
    relationName: "submissionReviewer",
  }),
  versions: many(submissionVersions),
}));

export const submissionVersionsRelations = relations(submissionVersions, ({ one }) => ({
  submission: one(submissions, {
    fields: [submissionVersions.submissionId],
    references: [submissions.id],
  }),
  createdByUser: one(users, {
    fields: [submissionVersions.createdByUserId],
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
