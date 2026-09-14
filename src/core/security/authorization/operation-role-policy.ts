import type { ApiId } from "./api-authorization-map";
import type { Role } from "./role.types";
import type { ScopeType } from "./scope.types";

/**
 * Wave 0D-4 Part A — operation-level role-ALTERNATIVE policy overrides.
 *
 * API_AUTHORIZATION_MAP's flat `scope`/`assignmentRequired`/
 * `authScopeRequired` fields represent a single combined requirement per
 * operation, which is correct for single-role operations and for
 * multi-role operations where every listed role genuinely shares the same
 * requirement. It is WRONG for the 36 operations below, where API
 * Contract v1.1's own bracket notation ("[ASG / Admin]",
 * "[ASG / Admin + AUTH_SCOPE]") expresses a role ALTERNATIVE: the
 * Consultant/Mentor path requires ASG (assignment), while the documented
 * Admin path is a separate operational-oversight grant that never requires
 * ASG (Admin is not "assigned" to anything) — confirmed by each
 * operation's own purpose text, e.g. API-ASM-002: "List operational
 * assessments: Consultant ASG; Admin all.", API-REV-001: "Role-scoped
 * review queue: Mentor ASG only; Admin permitted oversight."
 *
 * AUTH_SCOPE is NOT part of this alternative — per RBAC v1.0 §3/§8's
 * cross-cutting rule (also applied in the Wave 0D-3 Closure Pass at the
 * permission level), AUTH_SCOPE applies to Admin exactly as it applies to
 * Consultant on every operation the API Contract marks technical. Only
 * ASG is role-alternative; AUTH_SCOPE is role-independent.
 *
 * Populated for exactly the 36 operations identified by the Wave 0D-4
 * Phase 2 full-209-operation audit (every multi-role entry in the map —
 * there are no others). Every other operation (single-role, or the rare
 * genuinely-uniform multi-role case, of which none were found) is
 * untouched and continues to use the flat map fields.
 */
export interface OperationRolePolicy {
  readonly scopes: readonly ScopeType[];
  readonly assignmentRequired: boolean;
  readonly authScopeRequired: boolean;
  readonly resourceContextRequired: boolean;
  readonly conditionIds?: readonly string[];
}

export type OperationRolePolicies = Readonly<Partial<Record<Role, OperationRolePolicy>>>;

export const OPERATION_ROLE_POLICIES: Readonly<Partial<Record<ApiId, OperationRolePolicies>>> = {
  "API-ASM-001": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-ASM-002": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-ASM-003": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-ASM-004": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-ASM-005": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-COMP-001": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-COMP-002": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-006": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-007": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-009": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-010": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-011": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-012": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-CON-013": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-014": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-CON-015": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-FND-001": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-FND-002": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-FND-003": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-FND-004": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-FND-005": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-FND-006": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-FND-007": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-MON-004": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-REV-001": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-REV-002": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-REV-003": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-REV-004": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-REV-005": {
    ROLE_MENTOR: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-RPT-001": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-RPT-002": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-RPT-003": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-RPT-004": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-RPT-006": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
  "API-SCR-001": {
    ROLE_CONSULTANT: {
      scopes: ["ASG", "AUTH_SCOPE"],
      assignmentRequired: true,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: ["AUTH_SCOPE"],
      assignmentRequired: false,
      authScopeRequired: true,
      resourceContextRequired: true,
    },
  },
  "API-SCR-002": {
    ROLE_CONSULTANT: {
      scopes: ["ASG"],
      assignmentRequired: true,
      authScopeRequired: false,
      resourceContextRequired: true,
    },
    ROLE_ADMIN: {
      scopes: [],
      assignmentRequired: false,
      authScopeRequired: false,
      resourceContextRequired: false,
    },
  },
};

/**
 * Looks up the current role's operation-specific policy override, if this
 * operation has one. Returns `undefined` for the 173 operations with no
 * override (caller should fall back to the flat map fields) AND for a
 * role with no entry within an overridden operation's policy (e.g. a role
 * that somehow reached an overridden operation despite not being in its
 * `roles` list) — the latter case must be treated as a deny by the
 * caller, exactly like an unmapped permission-level role policy.
 */
export function getOperationRolePolicy(apiId: ApiId, role: Role): OperationRolePolicy | undefined {
  return OPERATION_ROLE_POLICIES[apiId]?.[role];
}
