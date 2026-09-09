import { randomUUID } from "node:crypto";

export function createRequestId(existingRequestId?: string | string[]) {
  if (Array.isArray(existingRequestId)) {
    return existingRequestId[0] ?? randomUUID();
  }

  return existingRequestId ?? randomUUID();
}
