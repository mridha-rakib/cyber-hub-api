import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Wave 0B first migration", () => {
  it("contains exactly the approved enums, tables and no destructive statements", async () => {
    const migrationsDir = resolve(__dirname, "../drizzle");
    const files = await readdir(migrationsDir);
    const [firstMigration] = files.filter((file) => file.endsWith(".sql")).sort();
    expect(firstMigration).toMatch(/^0000_/);

    const sql = await readFile(resolve(migrationsDir, firstMigration), "utf8");

    for (const enumName of ["user_role", "employer_status", "auth_token_purpose"]) {
      expect(sql).toContain(`CREATE TYPE "public"."${enumName}"`);
    }

    for (const tableName of ["users", "employers", "sessions", "auth_tokens", "audit_logs"]) {
      expect(sql).toContain(`CREATE TABLE "${tableName}"`);
    }

    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toContain("CASCADE");
  });
});
