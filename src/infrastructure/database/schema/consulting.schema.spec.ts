import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { consultingNotes } from "./consulting-notes";
import { consultingRequests } from "./consulting-requests";
import { consultingStatus, securityServiceType } from "./enums";
import { securityScopeAuthorizations } from "./security-scope-authorizations";

describe("Wave 4A consulting persistence schema", () => {
  it("uses the exact source table and enum names/values", () => {
    expect(getTableName(consultingRequests)).toBe("consulting_requests");
    expect(getTableName(consultingNotes)).toBe("consulting_notes");
    expect(getTableName(securityScopeAuthorizations)).toBe("security_scope_authorizations");
    expect(securityServiceType.enumValues).toEqual([
      "WEBSITE_ASSESSMENT",
      "NETWORK_ASSESSMENT",
      "VULNERABILITY_ASSESSMENT",
      "PHISHING_AWARENESS",
      "CLOUD_REVIEW",
      "CYBER_RISK_ASSESSMENT",
      "SECURITY_DOCUMENTATION",
    ]);
    expect(consultingStatus.enumValues).toEqual([
      "SUBMITTED",
      "UNDER_REVIEW",
      "ACCEPTED",
      "DECLINED",
      "IN_PROGRESS",
      "COMPLETED",
    ]);
  });

  it("keeps every lifecycle/ownership field server-owned and defaults state_version to 1", () => {
    const columns = getTableColumns(consultingRequests);
    expect(columns.employerId.notNull).toBe(true);
    expect(columns.submittedByUserId.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.stateVersion.notNull).toBe(true);
    expect(columns.stateVersion.default).toBe(1);
    expect(columns.assignedConsultantId.notNull).toBe(false);
  });

  it("defines the source-required descending request and note list indexes", () => {
    const requestIndexes = getTableConfig(consultingRequests).indexes.map((index) => index.config);
    const notesIndexes = getTableConfig(consultingNotes).indexes.map((index) => index.config);
    expect(
      requestIndexes.some(
        (index) => index.name === "consulting_requests_employer_status_submitted_idx",
      ),
    ).toBe(true);
    expect(
      notesIndexes.some((index) => index.name === "consulting_notes_request_created_desc_idx"),
    ).toBe(true);
  });

  it("keeps internal notes structurally outside consulting request rows", () => {
    const requestColumns = Object.keys(getTableColumns(consultingRequests));
    expect(requestColumns).not.toContain("notes");
    expect(Object.keys(getTableColumns(consultingNotes))).toEqual([
      "id",
      "consultingRequestId",
      "authorUserId",
      "body",
      "createdAt",
    ]);
  });
});
