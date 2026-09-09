import { ConflictException } from "@core/errors/app.exception";
import { IdempotencyService } from "./idempotency.service";
import { InMemoryIdempotencyStorage } from "./storage/in-memory-idempotency.storage";

describe("IdempotencyService", () => {
  it("reserves a new key and stores the completed response", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStorage());

    await service.reserve("key-1", "hash-1");
    await service.complete("key-1", { ok: true }, 201);

    await expect(service.getCompleted("key-1")).resolves.toMatchObject({
      key: "key-1",
      requestHash: "hash-1",
      responseBody: { ok: true },
      statusCode: 201,
      status: "completed",
    });
  });

  it("rejects the same key with a different request fingerprint", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStorage());

    await service.reserve("key-1", "hash-1");

    await expect(service.reserve("key-1", "hash-2")).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a duplicate request while the first request is in progress", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStorage());

    await service.reserve("key-1", "hash-1");

    await expect(service.reserve("key-1", "hash-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("releases an in-progress key after failure", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStorage());

    await service.reserve("key-1", "hash-1");
    await service.fail("key-1");

    await expect(service.reserve("key-1", "hash-1")).resolves.toBeUndefined();
  });
});
