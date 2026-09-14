/**
 * Authorization scope vocabulary, per RBAC & Permission Matrix v1.0 §4 and
 * System Architecture v1.2 §7.2. Resource-level evaluation of these scopes
 * is NOT implemented in Wave 0D-2 (see permission.guard.ts) — this module
 * only defines the vocabulary so it can be attached as static metadata to
 * permissions and API operations.
 */
export const ScopeTypes = ["OWN", "ORG", "ASG", "PUB", "COND", "AUTH_SCOPE"] as const;

export type ScopeType = (typeof ScopeTypes)[number];

export const isScopeType = (value: string): value is ScopeType =>
  (ScopeTypes as readonly string[]).includes(value);
