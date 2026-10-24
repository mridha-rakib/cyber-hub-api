import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { contentStatus } from "./enums";
import { resources } from "./resources";

/** F05: the committed migration-0008 `resources` definition (ERD v2.3 §7.5). */
describe("resources schema (ERD v2.3 §7.5)", () => {
  const config = getTableConfig(resources);
  const columns = getTableColumns(resources);

  it("has exactly the eleven approved columns", () => {
    expect(
      Object.values(columns)
        .map((c) => c.name)
        .sort(),
    ).toEqual(
      [
        "id",
        "title",
        "category",
        "tags",
        "content",
        "status",
        "featured",
        "published_at",
        "state_version",
        "created_at",
        "updated_at",
      ].sort(),
    );
  });

  it("defines nullability and defaults exactly", () => {
    expect(columns.publishedAt.notNull).toBe(false);
    for (const key of [
      "title",
      "category",
      "tags",
      "content",
      "status",
      "featured",
      "stateVersion",
    ] as const) {
      expect({ key, notNull: columns[key].notNull }).toEqual({ key, notNull: true });
    }
    expect(columns.featured.default).toBe(false);
    expect(columns.stateVersion.default).toBe(1);
    expect(columns.status.hasDefault).toBe(false);
  });

  it("uses content_status with exactly DRAFT, PUBLISHED, ARCHIVED", () => {
    expect(contentStatus.enumName).toBe("content_status");
    expect(contentStatus.enumValues).toEqual(["DRAFT", "PUBLISHED", "ARCHIVED"]);
  });

  it("has the state_version >= 1 check and the six approved indexes, no foreign keys", () => {
    expect(config.checks.map((c) => c.name)).toEqual(["resources_state_version_check"]);
    expect(config.indexes.map((i) => i.config.name).sort()).toEqual(
      [
        "resources_status_published_at_idx",
        "resources_category_status_idx",
        "resources_tags_gin_idx",
        "resources_featured_status_idx",
        "resources_status_featured_published_id_idx",
        "resources_created_at_id_idx",
      ].sort(),
    );
    expect(config.foreignKeys).toHaveLength(0);
  });
});
