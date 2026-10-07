import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Wave 4A consulting foundation migration", () => {
  it("adds only source-required consulting persistence without later-wave tables", async () => {
    const sql = await readFile(
      resolve(__dirname, "../drizzle/0005_wave4a_consulting_foundation.sql"),
      "utf8",
    );
    expect(sql).toContain('CREATE TABLE "consulting_notes"');
    expect(sql).toContain('FOREIGN KEY ("consulting_request_id")');
    expect(sql).toContain('FOREIGN KEY ("author_user_id")');
    expect(sql).toContain('"consulting_request_id","created_at" DESC');
    expect(sql).toContain('"employer_id","status","submitted_at" DESC');
    expect(sql).toContain('"security_scope_authorizations_confirmed_at_idx"');
    expect(sql).toContain('"security_scope_authorizations_is_current_idx"');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|CASCADE/i);
    for (const deferredTable of [
      "vulnerability_findings",
      "security_scores",
      "security_reports",
      "monitoring_subscriptions",
      "stored_objects",
    ]) {
      expect(sql).not.toContain(`CREATE TABLE "${deferredTable}"`);
    }
  });
});
