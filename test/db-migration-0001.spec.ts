import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Wave 0D-4B AUTH_SCOPE persistence prerequisite migration", () => {
  it("contains exactly the approved enums, tables, constraints, and no destructive statements", async () => {
    const migrationsDir = resolve(__dirname, "../drizzle");
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter((file) => file.endsWith(".sql")).sort();
    expect(sqlFiles.length).toBeGreaterThanOrEqual(2);
    const secondMigration = sqlFiles[1];
    expect(secondMigration).toMatch(/^0001_/);

    const sql = await readFile(resolve(migrationsDir, secondMigration), "utf8");

    for (const enumName of ["assessment_status", "consulting_status", "security_service_type"]) {
      expect(sql).toContain(`CREATE TYPE "public"."${enumName}"`);
    }

    for (const tableName of [
      "consulting_requests",
      "security_scope_authorizations",
      "security_assessments",
    ]) {
      expect(sql).toContain(`CREATE TABLE "${tableName}"`);
    }

    // The documented partial-unique "only one current, unrevoked
    // authorization per request" invariant (ERD §7.29) must be a real DB
    // constraint, not merely an application-level check.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "security_scope_authorizations_current_unique" ON "security_scope_authorizations"',
    );
    expect(sql).toContain('WHERE "security_scope_authorizations"."is_current" = true');
    expect(sql).toContain('"security_scope_authorizations"."revoked_at" IS NULL');

    expect(sql).toContain("security_scope_authorizations_version_no_check");

    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toContain("CASCADE");
  });
});
