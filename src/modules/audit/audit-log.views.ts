import type { AuditLog } from "../../infrastructure/database/schema";

/**
 * Metadata keys that may leave the API in AuditLogView (API Contract v1.5
 * §18: "metadata (minimized)"; ERD §7.39: "minimal reason/from/to/
 * transition/request references"). Writers already minimize at write time;
 * this allow-list is the read-side guarantee, so a future writer that adds
 * an unexpected key is withheld until it is reviewed and listed here.
 * Every key below was observed in existing writers (authorization audit,
 * consulting, security-work, score and report services).
 */
const SAFE_METADATA_KEYS = new Set([
  // authorization.allowed / authorization.denied
  "apiId",
  "permissionKey",
  "decision",
  "reasonCode",
  "evaluatedScopes",
  "disclosurePolicy",
  "workflowSensitive",
  "authScopeRequired",
  // workflow transitions
  "transitionId",
  "from",
  "to",
  "stateVersion",
  "versionNo",
  "reason",
  // related identifiers and changed-field names (never values)
  "assessmentId",
  "consultingRequestId",
  "findingIds",
  "addedFindingIds",
  "removedFindingIds",
  "affectedAssessmentIds",
  "changedFields",
  "oldConsultantId",
  "newConsultantId",
  // Wave 7B admin.user.role_changed (RBAC v1.1: "audit actor/target/old-role/new-role")
  "oldRole",
  "newRole",
]);

const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 200;

type SafeMetadataValue = string | number | boolean | null | string[];

/** Only scalars and string arrays survive; nested objects are never projected. */
function safeValue(value: unknown): SafeMetadataValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => item.slice(0, MAX_STRING_LENGTH));
  }
  return undefined;
}

export function minimizeAuditMetadata(metadata: unknown): Record<string, SafeMetadataValue> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const result: Record<string, SafeMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    const safe = safeValue(value);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

export interface AuditLogView {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  serviceContext: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  employerId: string | null;
  timestamp: string;
  metadata: Record<string, SafeMetadataValue>;
  requestId: string | null;
}

/** API Contract v1.5 §18 AuditLogView — exactly these fields, Admin only. */
export function toAuditLogView(row: AuditLog): AuditLogView {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    serviceContext: row.serviceContext,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    userId: row.userId,
    employerId: row.employerId,
    timestamp: row.timestamp.toISOString(),
    metadata: minimizeAuditMetadata(row.metadata),
    requestId: row.requestId,
  };
}
