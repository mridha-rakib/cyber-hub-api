import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MIGRATION = resolve(__dirname, "../drizzle/0007_wave6a_score_report_foundation.sql");

describe("Wave 6A security score + report persistence migration", () => {
  it("creates only report_status and the three ERD v2.2 §7.32-7.34 tables", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    expect(sql).toContain(
      `CREATE TYPE "public"."report_status" AS ENUM('DRAFT', 'IN_REVIEW', 'READY_FOR_RELEASE', 'RELEASED', 'SUPERSEDED')`,
    );
    expect(sql.match(/CREATE TYPE/g)).toHaveLength(1);
    expect(sql.match(/CREATE TABLE "[^"]+"/g)?.sort()).toEqual([
      'CREATE TABLE "security_report_findings"',
      'CREATE TABLE "security_reports"',
      'CREATE TABLE "security_scores"',
    ]);

    // security_scores: numeric(5,2) scores bounded 0-100, insert-only (no state_version).
    expect(sql).toContain('"overall_score" numeric(5, 2) NOT NULL');
    expect(sql).toContain('"backup_recovery_score" numeric(5, 2),');
    expect(sql).toContain('"methodology_version" text NOT NULL');
    expect(sql).toContain(
      'CHECK ("security_scores"."overall_score" >= 0 AND "security_scores"."overall_score" <= 100)',
    );
    expect(sql.match(/CONSTRAINT "security_scores_[a-z_]+_check" CHECK/g)).toHaveLength(8);

    // security_reports: versioned lifecycle row with lineage self-reference.
    expect(sql).toContain('"draft_content" jsonb NOT NULL');
    expect(sql).toContain('"status" "report_status" NOT NULL');
    expect(sql).toContain('"state_version" integer DEFAULT 1 NOT NULL');
    expect(sql).toContain(
      'CONSTRAINT "security_reports_assessment_version_key" UNIQUE("assessment_id","version_no")',
    );
    expect(sql).toContain('CHECK ("security_reports"."version_no" >= 1)');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "security_reports_report_path_unique" ON "security_reports" USING btree ("report_path") WHERE "security_reports"."report_path" IS NOT NULL',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("supersedes_report_id") REFERENCES "public"."security_reports"("id") ON DELETE no action',
    );
    expect(sql).toContain('"employer_id","status","released_at" DESC');
    expect(sql).toContain('"prepared_by_user_id","status"');

    // security_report_findings: composite-key membership only.
    expect(sql).toContain(
      'CONSTRAINT "security_report_findings_report_id_finding_id_pk" PRIMARY KEY("report_id","finding_id")',
    );
    expect(sql).toContain('"sort_order" integer DEFAULT 0 NOT NULL');
    expect(sql).toContain('"report_id","sort_order"');
    expect(sql).toContain(
      'FOREIGN KEY ("finding_id") REFERENCES "public"."vulnerability_findings"("id") ON DELETE no action',
    );

    // score history indexes
    expect(sql).toContain('"employer_id","calculated_at" DESC');
    expect(sql).toContain('"assessment_id","calculated_at" DESC');
  });

  it("is forward-only, non-cascading and adds no storage, visibility or snapshot objects", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    expect(sql).not.toMatch(/DROP |TRUNCATE|CASCADE|ALTER COLUMN|RENAME/i);
    // Every foreign key keeps governed history (ERD §5).
    const deleteRules = sql.match(/ON DELETE [a-z ]+? ON UPDATE/gi) ?? [];
    expect(deleteRules).toHaveLength(11);
    for (const rule of deleteRules) expect(rule).toBe("ON DELETE no action ON UPDATE");
    // Only new objects are altered.
    for (const altered of sql.match(/ALTER TABLE "[^"]+"/g) ?? []) {
      expect([
        'ALTER TABLE "security_scores"',
        'ALTER TABLE "security_reports"',
        'ALTER TABLE "security_report_findings"',
      ]).toContain(altered);
    }
    // GAP-013 storage stays Wave 7; D-1/D6-2/D6-4/D6-7 forbid these columns.
    for (const deferred of [
      "stored_objects",
      "stored_object_category",
      "stored_object_status",
      "monitoring_subscriptions",
    ]) {
      expect(sql).not.toContain(deferred);
    }
    expect(sql).not.toMatch(/visib|published|client_content|_snapshot|is_current/i);
  });
});
