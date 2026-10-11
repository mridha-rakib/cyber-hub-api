import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Wave 5A security findings foundation migration", () => {
  it("adds only the source-required findings persistence without later-wave tables", async () => {
    const sql = await readFile(
      resolve(__dirname, "../drizzle/0006_wave5a_security_findings_foundation.sql"),
      "utf8",
    );
    expect(sql).toContain(
      `CREATE TYPE "public"."finding_severity" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')`,
    );
    expect(sql).toContain(
      `CREATE TYPE "public"."finding_status" AS ENUM('OPEN', 'REMEDIATION_IN_PROGRESS', 'RESOLVED')`,
    );
    expect(sql).toContain('CREATE TABLE "vulnerability_findings"');
    expect(sql).toContain('"state_version" integer DEFAULT 1 NOT NULL');
    expect(sql).toContain(
      'FOREIGN KEY ("assessment_id") REFERENCES "public"."security_assessments"("id") ON DELETE no action',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE no action',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action',
    );
    expect(sql).toContain('"assessment_id","severity","status"');
    expect(sql).toContain('"employer_id","status","severity"');
    expect(sql).toContain('"created_by_user_id","created_at" DESC');
    expect(sql).toContain('"employer_id","status","created_at" DESC');
  });

  it("is forward-only and non-destructive", async () => {
    const sql = await readFile(
      resolve(__dirname, "../drizzle/0006_wave5a_security_findings_foundation.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DROP TYPE|TRUNCATE|CASCADE|ALTER COLUMN/i);
    // The only drop is the ERD §7.30 DESC correction of an index, which the
    // same migration recreates.
    expect(sql.match(/DROP INDEX "[^"]+"/g)).toEqual([
      'DROP INDEX "security_assessments_employer_status_created_idx"',
    ]);
    expect(sql).toContain('CREATE INDEX "security_assessments_employer_status_created_idx"');
    for (const deferredTable of [
      "security_scores",
      "security_reports",
      "security_report_findings",
      "monitoring_subscriptions",
      "stored_objects",
    ]) {
      expect(sql).not.toContain(`CREATE TABLE "${deferredTable}"`);
    }
  });
});
