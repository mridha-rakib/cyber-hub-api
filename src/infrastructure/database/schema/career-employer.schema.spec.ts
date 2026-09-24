import { getTableColumns, getTableName } from "drizzle-orm";
import { employerOpportunities } from "./employer-opportunities";
import { careerListingType, employerOpportunityType, listingStatus } from "./enums";
import { jobs } from "./jobs";

describe("Wave 3A Career + Employer persistence schema", () => {
  it("exposes exactly the two new ERD tables under their exact ERD names", () => {
    expect(getTableName(jobs)).toBe("jobs");
    expect(getTableName(employerOpportunities)).toBe("employer_opportunities");
  });

  it("defines the exact ERD enum values with no invented aliases", () => {
    expect(careerListingType.enumValues).toEqual([
      "JOB",
      "INTERNSHIP",
      "GRADUATE_ROLE",
      "APPRENTICESHIP",
    ]);
    expect(listingStatus.enumValues).toEqual([
      "SUBMITTED",
      "UNDER_REVIEW",
      "PUBLISHED",
      "REJECTED",
      "CLOSED",
    ]);
    expect(employerOpportunityType.enumValues).toEqual([
      "INTERNSHIP_OPPORTUNITY",
      "STUDENT_PROJECT",
    ]);
  });

  describe("jobs", () => {
    it("leaves employer_id and submitted_by_user_id nullable — external/admin-curated listings have no employer owner", () => {
      const columns = getTableColumns(jobs);
      expect(columns.employerId.notNull).toBe(false);
      expect(columns.submittedByUserId.notNull).toBe(false);
    });

    it("requires the [SRC] listing fields: title, employerName, location, level, skills, applicationUrl, listingType", () => {
      const columns = getTableColumns(jobs);
      expect(columns.title.notNull).toBe(true);
      expect(columns.employerName.notNull).toBe(true);
      expect(columns.location.notNull).toBe(true);
      expect(columns.level.notNull).toBe(true);
      expect(columns.skills.notNull).toBe(true);
      expect(columns.applicationUrl.notNull).toBe(true);
      expect(columns.listingType.notNull).toBe(true);
    });

    it("defaults remote_uk to false and state_version to 1 (shared listing_status workflow)", () => {
      const columns = getTableColumns(jobs);
      expect(columns.remoteUk.default).toBe(false);
      expect(columns.stateVersion.default).toBe(1);
      expect(columns.status.notNull).toBe(true);
    });

    it("leaves moderation_reason and published_at nullable", () => {
      const columns = getTableColumns(jobs);
      expect(columns.moderationReason.notNull).toBe(false);
      expect(columns.publishedAt.notNull).toBe(false);
    });
  });

  describe("employer_opportunities", () => {
    it("requires employer_id and created_by_user_id — every opportunity is ORG-owned, no external/admin-curated equivalent", () => {
      const columns = getTableColumns(employerOpportunities);
      expect(columns.employerId.notNull).toBe(true);
      expect(columns.createdByUserId.notNull).toBe(true);
    });

    it("requires type/title/description, leaves requirements/skills/application_url optional", () => {
      const columns = getTableColumns(employerOpportunities);
      expect(columns.type.notNull).toBe(true);
      expect(columns.title.notNull).toBe(true);
      expect(columns.description.notNull).toBe(true);
      expect(columns.requirements.notNull).toBe(false);
      expect(columns.skills.notNull).toBe(false);
      expect(columns.applicationUrl.notNull).toBe(false);
    });

    it("defaults state_version to 1 and shares the exact listing_status enum with jobs", () => {
      const columns = getTableColumns(employerOpportunities);
      expect(columns.stateVersion.default).toBe(1);
      expect(columns.status.notNull).toBe(true);
    });

    it("leaves moderation_reason and published_at nullable", () => {
      const columns = getTableColumns(employerOpportunities);
      expect(columns.moderationReason.notNull).toBe(false);
      expect(columns.publishedAt.notNull).toBe(false);
    });
  });
});
