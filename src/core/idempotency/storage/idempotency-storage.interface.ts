export const IDEMPOTENCY_STORAGE = Symbol("IDEMPOTENCY_STORAGE");

export type IdempotencyStatus = "processing" | "completed";

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseBody?: unknown;
  statusCode?: number;
  createdAt: Date;
  expiresAt?: Date;
}

export interface IIdempotencyStorage {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(record: IdempotencyRecord): Promise<void>;
  delete(key: string): Promise<void>;
}
