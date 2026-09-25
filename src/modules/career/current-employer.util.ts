import { AuthorizationMisconfiguredException } from "../../core/errors/app.exception";
import type { AuthPrincipal } from "../auth/services/session-authentication.types";

/**
 * Every route this is called from requires ORG scope, which
 * `ScopeEvaluationService.evaluateOrg` already denies whenever
 * `actor.employerId` is unset — so by the time a controller handler runs,
 * `principal.employerId` is guaranteed present. This makes that guarantee
 * explicit instead of an unchecked cast, and fails closed (rather than
 * silently proceeding with `undefined`) in the unreachable case the guard
 * somehow didn't run.
 */
export function requireEmployerId(principal: AuthPrincipal): string {
  if (!principal.employerId) {
    throw new AuthorizationMisconfiguredException("ROLE_BUSINESS principal has no employerId");
  }
  return principal.employerId;
}
