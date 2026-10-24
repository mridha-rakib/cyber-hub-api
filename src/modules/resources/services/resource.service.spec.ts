import type { TransactionManager } from "../../../core/database/transaction.manager";
import {
  NotFoundException,
  StateVersionConflictException,
  WorkflowConflictException,
} from "../../../core/errors/app.exception";
import type { RequestContextService } from "../../../core/request-context/request-context.service";
import { WorkflowValidationService } from "../../../core/workflow/workflow-validation.service";
import type { AuditLogsRepository } from "../../auth/repositories/audit-logs.repository";
import type { AuthPrincipal } from "../../auth/services/session-authentication.types";
import { RESOURCE_CURSOR_KINDS } from "../pagination/resource-cursor";
import type { ResourcesRepository } from "../repositories/resources.repository";
import type { ResourceAdminRow } from "../resource.views";
import { ResourceService } from "./resource.service";

const ID = "22222222-2222-4222-8222-222222222222";
const admin = { userId: "admin-1", role: "ROLE_ADMIN" } as AuthPrincipal;
const SECRET_URL = "https://secret.example.test/private";

function row(overrides: Partial<ResourceAdminRow> = {}): ResourceAdminRow {
  return {
    id: ID,
    title: "Title",
    category: "cat",
    tags: ["a"],
    content: { summary: "s", body: "b", links: [{ label: "l", url: SECRET_URL }] },
    status: "DRAFT",
    featured: false,
    publishedAt: null,
    stateVersion: 3,
    createdAt: new Date("2026-10-24T00:00:00Z"),
    updatedAt: new Date("2026-10-24T00:00:00Z"),
    ...overrides,
  };
}

function setup() {
  const repo = {
    insert: jest.fn(),
    findById: jest.fn(),
    findPublishedById: jest.fn(),
    lockById: jest.fn(),
    updateFields: jest.fn(),
    transition: jest.fn(),
    deleteGuarded: jest.fn(),
    listPublished: jest.fn(),
    listAdmin: jest.fn(),
  };
  const audits = { record: jest.fn().mockResolvedValue(undefined) };
  // Pass-through: rollback is PostgreSQL's job; here we prove a failing audit
  // propagates out of the transaction callback (which is what triggers it).
  const transactions = { runInTransaction: jest.fn((fn: () => Promise<unknown>) => fn()) };
  const context = { getRequestId: () => "req-1" };
  const service = new ResourceService(
    repo as unknown as ResourcesRepository,
    audits as unknown as AuditLogsRepository,
    transactions as unknown as TransactionManager,
    new WorkflowValidationService(),
    context as unknown as RequestContextService,
  );
  return { service, repo, audits, transactions };
}

const PUBLIC_KEYS = ["category", "content", "featured", "id", "publishedAt", "tags", "title"];
const ADMIN_KEYS = [...PUBLIC_KEYS, "createdAt", "stateVersion", "status", "updatedAt"].sort();

describe("ResourceService — lifecycle, concurrency and audit (Workflow v1.3 §5A.1/§5A.3)", () => {
  describe("create (WF-RES-01)", () => {
    it("inserts DRAFT (status from the registry) with featured default false, audits once, returns the admin view", async () => {
      const { service, repo, audits } = setup();
      repo.insert.mockResolvedValue(row({ stateVersion: 1 }));
      const view = await service.create(admin, {
        title: "T",
        category: "c",
        tags: ["a"],
        content: { summary: "s", body: "b" },
      });
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: "DRAFT", featured: false }),
      );
      expect(Object.keys(view).sort()).toEqual(ADMIN_KEYS);
      expect(audits.record).toHaveBeenCalledTimes(1);
      expect(audits.record).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        actorRole: "ROLE_ADMIN",
        action: "content.resource.created",
        entityType: "resources",
        entityId: ID,
        metadata: {
          apiId: "API-ADMRES-001",
          transitionId: "WF-RES-01",
          to: "DRAFT",
          stateVersion: 1,
        },
        requestId: "req-1",
      });
    });

    it("propagates an audit failure out of the transaction (no success returned)", async () => {
      const { service, repo, audits, transactions } = setup();
      repo.insert.mockResolvedValue(row({ stateVersion: 1 }));
      audits.record.mockRejectedValue(new Error("audit down"));
      await expect(
        service.create(admin, {
          title: "T",
          category: "c",
          tags: [],
          content: { summary: "s", body: "b" },
        }),
      ).rejects.toThrow("audit down");
      expect(transactions.runInTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("edit (EDIT_GUARD: DRAFT/PUBLISHED/ARCHIVED)", () => {
    it.each(["DRAFT", "PUBLISHED", "ARCHIVED"] as const)(
      "edits in %s without changing status",
      async (status) => {
        const { service, repo, audits } = setup();
        repo.lockById.mockResolvedValue(row({ status }));
        repo.updateFields.mockResolvedValue(row({ status, title: "New", stateVersion: 4 }));
        const view = await service.update(ID, admin, { title: "New", expectedStateVersion: 3 });
        expect(repo.updateFields).toHaveBeenCalledWith(ID, ["DRAFT", "PUBLISHED", "ARCHIVED"], 3, {
          title: "New",
        });
        expect(view.status).toBe(status);
        expect(audits.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "content.resource.updated",
            metadata: { apiId: "API-ADMRES-002", stateVersion: 4, changedFields: ["title"] },
          }),
        );
      },
    );

    it("records only the names of fields that actually changed — never values, content or URLs", async () => {
      const { service, repo, audits } = setup();
      repo.lockById.mockResolvedValue(row());
      repo.updateFields.mockResolvedValue(row({ stateVersion: 4 }));
      await service.update(ID, admin, {
        title: "Title", // unchanged
        content: { summary: "new", body: "b", links: [{ label: "l", url: SECRET_URL }] },
        expectedStateVersion: 3,
      });
      const entry = audits.record.mock.calls[0][0];
      expect(entry.metadata.changedFields).toEqual(["content"]);
      expect(JSON.stringify(entry)).not.toContain(SECRET_URL);
      expect(JSON.stringify(entry)).not.toContain("new");
    });
  });

  describe("publish (WF-RES-02 / WF-RES-04)", () => {
    it.each([
      ["DRAFT", "WF-RES-02"],
      ["ARCHIVED", "WF-RES-04"],
    ] as const)(
      "from %s uses %s, sets publishedAt to server time and audits the transition",
      async (from, transitionId) => {
        const { service, repo, audits } = setup();
        repo.lockById.mockResolvedValue(row({ status: from }));
        repo.transition.mockResolvedValue(
          row({ status: "PUBLISHED", stateVersion: 4, publishedAt: new Date() }),
        );
        const view = await service.publish(ID, admin, 3);
        expect(repo.transition).toHaveBeenCalledWith(ID, [from], "PUBLISHED", 3, {
          setPublishedAtNow: true,
        });
        expect(view).toMatchObject({ status: "PUBLISHED", stateVersion: 4 });
        expect(audits.record).toHaveBeenCalledTimes(1);
        expect(audits.record.mock.calls[0][0]).toMatchObject({
          action: "content.resource.published",
          metadata: {
            apiId: "API-ADMRES-003",
            transitionId,
            from,
            to: "PUBLISHED",
            stateVersion: 4,
          },
        });
      },
    );

    it("rejects publishing a PUBLISHED resource with STATE_CONFLICT and writes nothing", async () => {
      const { service, repo, audits } = setup();
      repo.lockById.mockResolvedValue(row({ status: "PUBLISHED" }));
      await expect(service.publish(ID, admin, 3)).rejects.toBeInstanceOf(WorkflowConflictException);
      expect(repo.transition).not.toHaveBeenCalled();
      expect(audits.record).not.toHaveBeenCalled();
    });
  });

  describe("archive (WF-RES-03)", () => {
    it("PUBLISHED -> ARCHIVED keeps publishedAt (no server-time reset)", async () => {
      const { service, repo, audits } = setup();
      repo.lockById.mockResolvedValue(row({ status: "PUBLISHED" }));
      repo.transition.mockResolvedValue(row({ status: "ARCHIVED", stateVersion: 4 }));
      await service.archive(ID, admin, 3);
      expect(repo.transition).toHaveBeenCalledWith(ID, ["PUBLISHED"], "ARCHIVED", 3, {
        setPublishedAtNow: false,
      });
      expect(audits.record.mock.calls[0][0].metadata).toEqual({
        apiId: "API-ADMRES-004",
        transitionId: "WF-RES-03",
        from: "PUBLISHED",
        to: "ARCHIVED",
        stateVersion: 4,
      });
    });

    it.each(["DRAFT", "ARCHIVED"] as const)("rejects archiving from %s", async (status) => {
      const { service, repo } = setup();
      repo.lockById.mockResolvedValue(row({ status }));
      await expect(service.archive(ID, admin, 3)).rejects.toBeInstanceOf(WorkflowConflictException);
      expect(repo.transition).not.toHaveBeenCalled();
    });
  });

  describe("delete (DELETE_GUARD: DRAFT only, version-checked, no increment)", () => {
    it("deletes a DRAFT at the expected version and audits from/stateVersion only", async () => {
      const { service, repo, audits } = setup();
      repo.lockById.mockResolvedValue(row());
      repo.deleteGuarded.mockResolvedValue({ id: ID, status: "DRAFT", stateVersion: 3 });
      await expect(service.delete(ID, admin, 3)).resolves.toBeUndefined();
      expect(repo.deleteGuarded).toHaveBeenCalledWith(ID, ["DRAFT"], 3);
      expect(audits.record).toHaveBeenCalledTimes(1);
      expect(audits.record.mock.calls[0][0]).toMatchObject({
        action: "content.resource.deleted",
        metadata: { apiId: "API-ADMRES-005", from: "DRAFT", stateVersion: 3 },
      });
    });

    it.each(["PUBLISHED", "ARCHIVED"] as const)(
      "never deletes a %s resource (STATE_CONFLICT, no audit)",
      async (status) => {
        const { service, repo, audits } = setup();
        repo.lockById.mockResolvedValue(row({ status }));
        await expect(service.delete(ID, admin, 3)).rejects.toBeInstanceOf(
          WorkflowConflictException,
        );
        expect(repo.deleteGuarded).not.toHaveBeenCalled();
        expect(audits.record).not.toHaveBeenCalled();
      },
    );
  });

  describe("error precedence (W7C-12): 404 -> STATE_VERSION_CONFLICT -> STATE_CONFLICT", () => {
    const commands = (service: ResourceService) => [
      () => service.update(ID, admin, { title: "x", expectedStateVersion: 2 }),
      () => service.publish(ID, admin, 2),
      () => service.archive(ID, admin, 2),
      () => service.delete(ID, admin, 2),
    ];

    it("missing record -> 404 for every mutation", async () => {
      const { service, repo } = setup();
      repo.lockById.mockResolvedValue(null);
      for (const run of commands(service))
        await expect(run()).rejects.toBeInstanceOf(NotFoundException);
    });

    it("stale version wins over a disallowed state and reports details.currentStateVersion", async () => {
      const { service, repo, audits } = setup();
      repo.lockById.mockResolvedValue(row({ status: "ARCHIVED", stateVersion: 9 }));
      for (const run of commands(service)) {
        const error = await run().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(StateVersionConflictException);
        expect((error as StateVersionConflictException).metadata).toEqual({
          currentStateVersion: 9,
        });
      }
      expect(repo.updateFields).not.toHaveBeenCalled();
      expect(repo.transition).not.toHaveBeenCalled();
      expect(repo.deleteGuarded).not.toHaveBeenCalled();
      expect(audits.record).not.toHaveBeenCalled();
    });

    it("a conditional write that matches nothing under the lock is classified from a fresh read, with no audit", async () => {
      const { service, repo, audits } = setup();
      repo.lockById.mockResolvedValue(row());
      repo.updateFields.mockResolvedValue(null);
      repo.findById.mockResolvedValue(row({ stateVersion: 5 }));
      await expect(
        service.update(ID, admin, { title: "x", expectedStateVersion: 3 }),
      ).rejects.toBeInstanceOf(StateVersionConflictException);
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update(ID, admin, { title: "x", expectedStateVersion: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audits.record).not.toHaveBeenCalled();
    });
  });

  describe("reads and projections", () => {
    it("public detail is PUBLISHED-only (repository predicate) and exposes exactly ResourceView", async () => {
      const { service, repo } = setup();
      repo.findPublishedById.mockResolvedValue(null);
      await expect(service.getPublished(ID)).rejects.toBeInstanceOf(NotFoundException);
      repo.findPublishedById.mockResolvedValue(
        row({ status: "PUBLISHED", publishedAt: new Date() }),
      );
      const view = await service.getPublished(ID);
      expect(Object.keys(view).sort()).toEqual(PUBLIC_KEYS);
    });

    it("public list maps to ResourceView and issues a cursor of the requested kind", async () => {
      const { service, repo } = setup();
      repo.listPublished.mockResolvedValue([
        { ...row({ status: "PUBLISHED" }), cursorSortValue: "2026-10-24T08:00:00.123456Z" },
        {
          ...row({ id: "33333333-3333-4333-8333-333333333333" }),
          cursorSortValue: "2026-10-24T07:00:00.000001Z",
        },
      ]);
      const page = await service.listPublished({
        sort: "featured",
        limit: 1,
        kind: RESOURCE_CURSOR_KINDS.publicFeatured,
        cursor: undefined,
      });
      expect(page.data).toHaveLength(1);
      expect(Object.keys(page.data[0]).sort()).toEqual(PUBLIC_KEYS);
      expect(page.meta.page.hasMore).toBe(true);
    });

    it("admin detail returns any state with the full admin projection; missing -> 404", async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(row({ status: "ARCHIVED" }));
      expect(Object.keys(await service.getAdmin(ID)).sort()).toEqual(ADMIN_KEYS);
      repo.findById.mockResolvedValue(null);
      await expect(service.getAdmin(ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
