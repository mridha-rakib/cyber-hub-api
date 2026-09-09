import { ConflictException } from "@core/errors/app.exception";
import { Inject, Injectable } from "@nestjs/common";
import {
  IDEMPOTENCY_STORAGE,
  type IdempotencyRecord,
  type IIdempotencyStorage,
} from "./storage/idempotency-storage.interface";

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_STORAGE)
    private readonly storage: IIdempotencyStorage,
  ) {}

  async getCompleted(key: string): Promise<IdempotencyRecord | null> {
    const record = await this.storage.get(key);
    return record?.status === "completed" ? record : null;
  }

  async reserve(key: string, requestHash: string): Promise<void> {
    const existing = await this.storage.get(key);

    if (existing && existing.requestHash !== requestHash) {
      throw new ConflictException("Idempotency key was already used for a different request");
    }

    if (existing?.status === "processing") {
      throw new ConflictException("Request with this idempotency key is already in progress");
    }

    if (!existing) {
      await this.storage.set({
        key,
        requestHash,
        status: "processing",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }
  }

  async complete(key: string, responseBody: unknown, statusCode: number): Promise<void> {
    const existing = await this.storage.get(key);

    if (!existing) {
      return;
    }

    await this.storage.set({
      ...existing,
      status: "completed",
      responseBody,
      statusCode,
    });
  }

  async fail(key: string): Promise<void> {
    const existing = await this.storage.get(key);

    if (existing?.status === "processing") {
      await this.storage.delete(key);
    }
  }
}
