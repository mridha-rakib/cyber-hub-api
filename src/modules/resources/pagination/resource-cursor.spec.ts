import {
  buildResourceCursorPage,
  decodeResourceCursor,
  encodeResourceCursor,
  RESOURCE_CURSOR_KINDS,
} from "./resource-cursor";

const ID = "11111111-1111-4111-8111-111111111111";
const T = "2026-10-24T08:00:00.123456Z";

describe("Resource keyset cursors (W7C-10)", () => {
  it("round-trips each kind and keeps the featured flag only on the featured kind", () => {
    const recent = encodeResourceCursor(RESOURCE_CURSOR_KINDS.publicRecent, {
      sortValue: T,
      id: ID,
    });
    expect(decodeResourceCursor(recent, RESOURCE_CURSOR_KINDS.publicRecent)).toEqual({
      sortValue: T,
      id: ID,
    });
    for (const f of [true, false]) {
      const featured = encodeResourceCursor(RESOURCE_CURSOR_KINDS.publicFeatured, {
        sortValue: T,
        id: ID,
        featured: f,
      });
      expect(decodeResourceCursor(featured, RESOURCE_CURSOR_KINDS.publicFeatured)).toEqual({
        sortValue: T,
        id: ID,
        featured: f,
      });
    }
    const admin = encodeResourceCursor(RESOURCE_CURSOR_KINDS.adminRecent, { sortValue: T, id: ID });
    expect(decodeResourceCursor(admin, RESOURCE_CURSOR_KINDS.adminRecent)).toEqual({
      sortValue: T,
      id: ID,
    });
  });

  it("binds each cursor to exactly one list + sort", () => {
    const recent = encodeResourceCursor(RESOURCE_CURSOR_KINDS.publicRecent, {
      sortValue: T,
      id: ID,
    });
    expect(decodeResourceCursor(recent, RESOURCE_CURSOR_KINDS.publicFeatured)).toBeNull();
    expect(decodeResourceCursor(recent, RESOURCE_CURSOR_KINDS.adminRecent)).toBeNull();
    const admin = encodeResourceCursor(RESOURCE_CURSOR_KINDS.adminRecent, { sortValue: T, id: ID });
    expect(decodeResourceCursor(admin, RESOURCE_CURSOR_KINDS.publicRecent)).toBeNull();
  });

  const raw = (payload: unknown) =>
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  it.each([
    [
      "missing featured flag on featured kind",
      { v: 1, k: RESOURCE_CURSOR_KINDS.publicFeatured, t: T, i: ID },
      RESOURCE_CURSOR_KINDS.publicFeatured,
    ],
    [
      "featured flag on a recent kind",
      { v: 1, k: RESOURCE_CURSOR_KINDS.publicRecent, f: true, t: T, i: ID },
      RESOURCE_CURSOR_KINDS.publicRecent,
    ],
    [
      "millisecond timestamp",
      { v: 1, k: RESOURCE_CURSOR_KINDS.publicRecent, t: "2026-10-24T08:00:00.123Z", i: ID },
      RESOURCE_CURSOR_KINDS.publicRecent,
    ],
    [
      "non-uuid id",
      { v: 1, k: RESOURCE_CURSOR_KINDS.publicRecent, t: T, i: "x" },
      RESOURCE_CURSOR_KINDS.publicRecent,
    ],
    [
      "unknown version",
      { v: 2, k: RESOURCE_CURSOR_KINDS.publicRecent, t: T, i: ID },
      RESOURCE_CURSOR_KINDS.publicRecent,
    ],
    [
      "extra key (SQL fragment)",
      { v: 1, k: RESOURCE_CURSOR_KINDS.publicRecent, t: T, i: ID, sql: "1=1" },
      RESOURCE_CURSOR_KINDS.publicRecent,
    ],
    [
      "non-boolean flag",
      { v: 1, k: RESOURCE_CURSOR_KINDS.publicFeatured, f: "true", t: T, i: ID },
      RESOURCE_CURSOR_KINDS.publicFeatured,
    ],
  ])("rejects a tampered cursor: %s", (_name, payload, kind) => {
    expect(decodeResourceCursor(raw(payload), kind)).toBeNull();
  });

  it("rejects malformed encodings", () => {
    for (const value of [
      "",
      "!!!",
      "e30=",
      "x".repeat(600),
      Buffer.from("not json").toString("base64url"),
    ]) {
      expect(decodeResourceCursor(value, RESOURCE_CURSOR_KINDS.publicRecent)).toBeNull();
    }
  });

  it("builds limit+1 pages: hasMore/nextCursor from the last kept row; final page has no cursor", () => {
    const rows = [0, 1, 2].map((n) => ({
      id: `1111111${n}-1111-4111-8111-111111111111`,
      cursorSortValue: T,
      featured: n === 0,
    }));
    const page = buildResourceCursorPage(rows, 2, RESOURCE_CURSOR_KINDS.publicFeatured);
    expect(page.data).toHaveLength(2);
    expect(page.meta.page).toMatchObject({ limit: 2, hasMore: true });
    expect(
      decodeResourceCursor(page.meta.page.nextCursor ?? "", RESOURCE_CURSOR_KINDS.publicFeatured),
    ).toEqual({
      sortValue: T,
      id: rows[1].id,
      featured: false,
    });
    const last = buildResourceCursorPage(rows.slice(0, 2), 2, RESOURCE_CURSOR_KINDS.publicFeatured);
    expect(last.meta.page).toEqual({ limit: 2, nextCursor: null, hasMore: false });
    expect(buildResourceCursorPage([], 25, RESOURCE_CURSOR_KINDS.publicRecent).meta.page).toEqual({
      limit: 25,
      nextCursor: null,
      hasMore: false,
    });
  });
});
