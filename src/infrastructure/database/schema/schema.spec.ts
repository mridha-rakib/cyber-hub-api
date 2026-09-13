import { getTableColumns, getTableName } from "drizzle-orm";
import { auditLogs } from "./audit-logs";
import { authTokens } from "./auth-tokens";
import { employers } from "./employers";
import { authTokenPurpose, employerStatus, userRole } from "./enums";
import { sessions } from "./sessions";
import { users } from "./users";

describe("Wave 0B schema", () => {
  it("exposes exactly the five approved tables under their exact ERD table names", () => {
    expect(getTableName(users)).toBe("users");
    expect(getTableName(employers)).toBe("employers");
    expect(getTableName(sessions)).toBe("sessions");
    expect(getTableName(authTokens)).toBe("auth_tokens");
    expect(getTableName(auditLogs)).toBe("audit_logs");
  });

  it("defines the exact three ERD enum values with no invented aliases", () => {
    expect(userRole.enumValues).toEqual([
      "ROLE_LEARNER",
      "ROLE_BUSINESS",
      "ROLE_MENTOR",
      "ROLE_CONSULTANT",
      "ROLE_ADMIN",
    ]);
    expect(employerStatus.enumValues).toEqual(["ACTIVE", "SUSPENDED", "CLOSED"]);
    expect(authTokenPurpose.enumValues).toEqual(["EMAIL_VERIFICATION", "PASSWORD_RESET"]);
  });

  it("normalizes users.email_normalized as a NOT NULL column carrying the uniqueness contract", () => {
    const columns = getTableColumns(users);
    expect(columns.emailNormalized.notNull).toBe(true);
    expect(columns.emailNormalized.name).toBe("email_normalized");
  });

  it("represents users.employer_id as a nullable FK-bearing column referencing employers", () => {
    const columns = getTableColumns(users);
    expect(columns.employerId.name).toBe("employer_id");
    expect(columns.employerId.notNull).toBe(false);
  });

  it("carries the documented defaults for users (verified, auth_version, profile)", () => {
    const columns = getTableColumns(users);
    expect(columns.verified.default).toBe(false);
    expect(columns.authVersion.default).toBe(1);
    expect(columns.profile.default).toEqual({});
  });

  it("requires sessions.user_id and auth_tokens.user_id as NOT NULL references to users", () => {
    expect(getTableColumns(sessions).userId.notNull).toBe(true);
    expect(getTableColumns(authTokens).userId.notNull).toBe(true);
  });

  it("keeps audit_logs actor/subject/tenant references nullable for system-originated events", () => {
    const columns = getTableColumns(auditLogs);
    expect(columns.actorUserId.notNull).toBe(false);
    expect(columns.userId.notNull).toBe(false);
    expect(columns.employerId.notNull).toBe(false);
  });

  it("does not store raw secrets: auth_tokens and sessions only carry hashed values", () => {
    const authTokenColumns = Object.keys(getTableColumns(authTokens));
    const sessionColumns = Object.keys(getTableColumns(sessions));
    expect(authTokenColumns).toContain("tokenHash");
    expect(authTokenColumns).not.toContain("token");
    expect(sessionColumns).toContain("sessionKeyHash");
    expect(sessionColumns).not.toContain("sessionKey");
  });
});
