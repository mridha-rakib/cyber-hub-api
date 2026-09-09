import { randomUUID } from "node:crypto";

export function createRequestId(existingRequestId?: string | string[]) {
  return typeof existingRequestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(existingRequestId)
    ? existingRequestId
    : randomUUID();
}
