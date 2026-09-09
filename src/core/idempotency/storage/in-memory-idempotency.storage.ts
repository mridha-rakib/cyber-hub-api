import { Injectable } from "@nestjs/common";
import type { IdempotencyRecord, IIdempotencyStorage } from "./idempotency-storage.interface";

@Injectable()
export class InMemoryIdempotencyStorage implements IIdempotencyStorage {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    const record = this.records.get(key);

    if (!record) {
      return null;
    }

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      this.records.delete(key);
      return null;
    }

    return record;
  }

  async set(record: IdempotencyRecord): Promise<void> {
    this.records.set(record.key, record);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}
