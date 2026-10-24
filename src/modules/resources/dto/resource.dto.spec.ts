import { encodeResourceCursor, RESOURCE_CURSOR_KINDS } from "../pagination/resource-cursor";
import {
  adminResourceListQuerySchema,
  publicResourceListQuerySchema,
  resourceCreateSchema,
  resourceDeleteBodySchema,
  resourceDeleteQuerySchema,
  resourceTransitionSchema,
  resourceUpdateSchema,
} from "./resource.dto";

const valid = () => ({
  title: "Intro to threat modelling",
  category: "fundamentals",
  tags: ["threat-modelling"],
  content: { summary: "A short summary.", body: "Line one.\nLine two." },
});
const ok = (input: unknown) => resourceCreateSchema.safeParse(input).success;
const astral = "\u{1F512}"; // 2 UTF-16 code units

describe("ResourceWriteInput validation (API Contract v1.6 W7C-11)", () => {
  it("accepts a valid create payload and trims strings while keeping body line breaks", () => {
    const parsed = resourceCreateSchema.parse({
      ...valid(),
      title: "  Title  ",
      content: { summary: "  s  ", body: "  a\nb  " },
    });
    expect(parsed.title).toBe("Title");
    expect(parsed.content.summary).toBe("s");
    expect(parsed.content.body).toBe("a\nb");
    expect(parsed.featured).toBeUndefined();
  });

  it.each([
    ["title", 200],
    ["category", 100],
  ])("enforces %s 1..%d UTF-16 code units after trimming", (field, max) => {
    expect(ok({ ...valid(), [field]: "x".repeat(max) })).toBe(true);
    expect(ok({ ...valid(), [field]: "x".repeat(max + 1) })).toBe(false);
    expect(ok({ ...valid(), [field]: "   " })).toBe(false);
    expect(ok({ ...valid(), [field]: "" })).toBe(false);
    expect(ok({ ...valid(), [field]: `  ${"x".repeat(max)}  ` })).toBe(true);
  });

  it("counts astral characters as two UTF-16 code units", () => {
    expect(ok({ ...valid(), title: astral.repeat(100) })).toBe(true); // 200 units
    expect(ok({ ...valid(), title: `${astral.repeat(100)}x` })).toBe(false); // 201 units
  });

  it("requires title, category, tags and content on create", () => {
    for (const field of ["title", "category", "tags", "content"]) {
      const input: Record<string, unknown> = valid();
      delete input[field];
      expect({ field, ok: ok(input) }).toEqual({ field, ok: false });
    }
  });

  it("rejects wrong types", () => {
    expect(ok({ ...valid(), title: 42 })).toBe(false);
    expect(ok({ ...valid(), tags: "a,b" })).toBe(false);
    expect(ok({ ...valid(), tags: [1] })).toBe(false);
    expect(ok({ ...valid(), content: "text" })).toBe(false);
    expect(ok({ ...valid(), featured: "true" })).toBe(false);
  });

  it("limits tags to 20 items of 1..50 and removes duplicates by case-sensitive exact match after trimming", () => {
    const parsed = resourceCreateSchema.parse({ ...valid(), tags: ["a", " a ", "A", "b"] });
    expect(parsed.tags).toEqual(["a", "A", "b"]);
    expect(ok({ ...valid(), tags: Array.from({ length: 20 }, (_, i) => `t${i}`) })).toBe(true);
    expect(ok({ ...valid(), tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toBe(false);
    expect(ok({ ...valid(), tags: ["x".repeat(50)] })).toBe(true);
    expect(ok({ ...valid(), tags: ["x".repeat(51)] })).toBe(false);
    expect(ok({ ...valid(), tags: ["  "] })).toBe(false);
  });

  it("enforces summary 1..500 and body 1..20000", () => {
    const content = (summary: string, body: string) => ({ ...valid(), content: { summary, body } });
    expect(ok(content("x".repeat(500), "b"))).toBe(true);
    expect(ok(content("x".repeat(501), "b"))).toBe(false);
    expect(ok(content("s", "x".repeat(20000)))).toBe(true);
    expect(ok(content("s", "x".repeat(20001)))).toBe(false);
    expect(ok(content(" ", "b"))).toBe(false);
  });

  it("rejects unknown content keys, unknown link keys and prototype-pollution keys", () => {
    expect(ok({ ...valid(), content: { ...valid().content, html: "<b>x</b>" } })).toBe(false);
    expect(
      ok({
        ...valid(),
        content: { ...valid().content, links: [{ label: "x", url: "https://a.test", rel: "x" }] },
      }),
    ).toBe(false);
    expect(
      ok(
        JSON.parse(
          '{"title":"t","category":"c","tags":[],"content":{"summary":"s","body":"b","__proto__":{"x":1}}}',
        ),
      ),
    ).toBe(false);
    expect(
      ok(JSON.parse(`{${JSON.stringify(valid()).slice(1, -1)},"__proto__":{"polluted":true}}`)),
    ).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects extra top-level fields, including server-owned ones", () => {
    for (const field of [
      "id",
      "status",
      "publishedAt",
      "stateVersion",
      "createdAt",
      "updatedAt",
      "extra",
    ]) {
      expect({ field, ok: ok({ ...valid(), [field]: "x" }) }).toEqual({ field, ok: false });
    }
  });

  it("accepts up to 10 https links with labels 1..120 and rejects more", () => {
    const link = (i: number) => ({ label: `L${i}`, url: `https://example.test/${i}` });
    const withLinks = (n: number) => ({
      ...valid(),
      content: { ...valid().content, links: Array.from({ length: n }, (_, i) => link(i)) },
    });
    expect(ok(withLinks(10))).toBe(true);
    expect(ok(withLinks(11))).toBe(false);
    expect(
      ok({
        ...valid(),
        content: { ...valid().content, links: [{ label: "x".repeat(121), url: "https://a.test" }] },
      }),
    ).toBe(false);
  });

  it.each([
    "http://example.test",
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://example.test",
    "//example.test/x",
    "/relative/path",
    "https://user:pass@example.test",
    "https://user@example.test",
    "not a url",
    `https://example.test/${"x".repeat(2040)}`,
  ])("rejects unsafe or invalid link URL %s", (url) => {
    expect(ok({ ...valid(), content: { ...valid().content, links: [{ label: "x", url }] } })).toBe(
      false,
    );
  });

  it("accepts a maximum-length (2048) https URL", () => {
    const url = `https://example.test/${"x".repeat(2048 - "https://example.test/".length)}`;
    expect(url.length).toBe(2048);
    expect(ok({ ...valid(), content: { ...valid().content, links: [{ label: "x", url }] } })).toBe(
      true,
    );
  });

  it("rejects disallowed control characters but allows tab, LF and CR", () => {
    for (const ch of ["\u0000", "\u0008", "\u000B", "\u000C", "\u000E", "\u001F", "\u007F"]) {
      expect(ok({ ...valid(), title: `a${ch}b` })).toBe(false);
      expect(ok({ ...valid(), content: { summary: "s", body: `a${ch}b` } })).toBe(false);
    }
    expect(ok({ ...valid(), content: { summary: "s", body: "a\tb\nc\r\nd" } })).toBe(true);
  });

  it("stores markup as plain text (never interpreted or sanitized)", () => {
    const parsed = resourceCreateSchema.parse({
      ...valid(),
      content: { summary: "<b>x</b>", body: "**md**" },
    });
    expect(parsed.content).toEqual({ summary: "<b>x</b>", body: "**md**" });
  });
});

describe("PATCH / transition / DELETE preconditions", () => {
  it("PATCH accepts a partial field set plus expectedStateVersion and rejects anything else", () => {
    expect(resourceUpdateSchema.safeParse({ title: "New", expectedStateVersion: 1 }).success).toBe(
      true,
    );
    expect(resourceUpdateSchema.safeParse({ title: "New" }).success).toBe(false);
    expect(resourceUpdateSchema.safeParse({ expectedStateVersion: 1 }).success).toBe(false);
    expect(
      resourceUpdateSchema.safeParse({ status: "PUBLISHED", expectedStateVersion: 1 }).success,
    ).toBe(false);
    expect(resourceUpdateSchema.safeParse({ title: "x", expectedStateVersion: 0 }).success).toBe(
      false,
    );
    expect(resourceUpdateSchema.safeParse({ title: "x", expectedStateVersion: 1.5 }).success).toBe(
      false,
    );
    expect(resourceUpdateSchema.safeParse({ title: "x", expectedStateVersion: "1" }).success).toBe(
      false,
    );
  });

  it("transition body is exactly { expectedStateVersion }", () => {
    expect(resourceTransitionSchema.safeParse({ expectedStateVersion: 3 }).success).toBe(true);
    expect(resourceTransitionSchema.safeParse({}).success).toBe(false);
    expect(
      resourceTransitionSchema.safeParse({ expectedStateVersion: 3, status: "X" }).success,
    ).toBe(false);
    expect(resourceTransitionSchema.safeParse({ expectedStateVersion: 2147483648 }).success).toBe(
      false,
    );
  });

  it.each(["1", "7", "2147483647"])("DELETE accepts expectedStateVersion=%s", (value) => {
    expect(resourceDeleteQuerySchema.parse({ expectedStateVersion: value })).toEqual({
      expectedStateVersion: Number(value),
    });
  });

  it.each([
    [{}],
    [{ expectedStateVersion: "0" }],
    [{ expectedStateVersion: "01" }],
    [{ expectedStateVersion: "+1" }],
    [{ expectedStateVersion: "-1" }],
    [{ expectedStateVersion: "1.0" }],
    [{ expectedStateVersion: "1e3" }],
    [{ expectedStateVersion: " 1" }],
    [{ expectedStateVersion: "2147483648" }],
    [{ expectedStateVersion: ["1", "1"] }],
    [{ expectedStateVersion: "1", extra: "x" }],
  ])("DELETE rejects query %j", (query) => {
    expect(resourceDeleteQuerySchema.safeParse(query).success).toBe(false);
  });

  it("DELETE accepts no body or an empty object only", () => {
    expect(resourceDeleteBodySchema.safeParse(undefined).success).toBe(true);
    expect(resourceDeleteBodySchema.safeParse({}).success).toBe(true);
    expect(resourceDeleteBodySchema.safeParse({ expectedStateVersion: 1 }).success).toBe(false);
  });
});

describe("list query validation (W7C-9/W7C-10)", () => {
  it("defaults public sort to recent and limit to 25; caps limit at 100", () => {
    const parsed = publicResourceListQuerySchema.parse({});
    expect(parsed).toMatchObject({
      sort: "recent",
      limit: 25,
      kind: RESOURCE_CURSOR_KINDS.publicRecent,
    });
    expect(publicResourceListQuerySchema.safeParse({ limit: "100" }).success).toBe(true);
    expect(publicResourceListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(publicResourceListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("rejects private-state or unknown query keys on the public list", () => {
    for (const key of ["status", "includeDraft", "stateVersion", "foo"]) {
      expect({ key, ok: publicResourceListQuerySchema.safeParse({ [key]: "x" }).success }).toEqual({
        key,
        ok: false,
      });
    }
  });

  it("trims q to 1..100 and rejects longer or blank queries", () => {
    expect(publicResourceListQuerySchema.parse({ q: "  50%_off  " }).q).toBe("50%_off");
    expect(publicResourceListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(publicResourceListQuerySchema.safeParse({ q: "   " }).success).toBe(false);
  });

  it("binds the cursor to its list and sort", () => {
    const recent = encodeResourceCursor(RESOURCE_CURSOR_KINDS.publicRecent, {
      sortValue: "2026-10-24T08:00:00.123456Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    const featured = encodeResourceCursor(RESOURCE_CURSOR_KINDS.publicFeatured, {
      sortValue: "2026-10-24T08:00:00.123456Z",
      id: "11111111-1111-4111-8111-111111111111",
      featured: true,
    });
    expect(publicResourceListQuerySchema.safeParse({ cursor: recent }).success).toBe(true);
    expect(
      publicResourceListQuerySchema.safeParse({ cursor: recent, sort: "featured" }).success,
    ).toBe(false);
    expect(
      publicResourceListQuerySchema.safeParse({ cursor: featured, sort: "featured" }).success,
    ).toBe(true);
    expect(publicResourceListQuerySchema.safeParse({ cursor: featured }).success).toBe(false);
    expect(adminResourceListQuerySchema.safeParse({ cursor: recent }).success).toBe(false);
    expect(publicResourceListQuerySchema.safeParse({ cursor: "not-a-cursor" }).success).toBe(false);
  });

  it("admin list accepts only approved status values and sort=recent", () => {
    expect(adminResourceListQuerySchema.safeParse({ status: "ARCHIVED" }).success).toBe(true);
    expect(adminResourceListQuerySchema.safeParse({ status: "WITHDRAWN" }).success).toBe(false);
    expect(adminResourceListQuerySchema.safeParse({ sort: "featured" }).success).toBe(false);
    expect(adminResourceListQuerySchema.safeParse({ featured: "yes" }).success).toBe(false);
    expect(adminResourceListQuerySchema.parse({ featured: "true" }).featured).toBe(true);
  });
});
