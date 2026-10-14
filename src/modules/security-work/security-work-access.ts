import { NotFoundException, PermissionDeniedException } from "../../core/errors/app.exception";
import type { ConsultingRequest, SecurityAssessment } from "../../infrastructure/database/schema";
import type { AuthPrincipal } from "../auth/services/session-authentication.types";

/**
 * Shared operational access predicates for security work (Wave 5B D-4 and
 * Wave 6 D6-6). These run inside the mutation transaction, after the request
 * and assessment rows are locked, so a reassignment that commits first is
 * always observed. Consultant failures are concealed as 404; Admin acts only
 * through documented Admin operation grants and is never ASG-checked.
 */
export function requireOperationalRole(principal: AuthPrincipal) {
  if (principal.role !== "ROLE_ADMIN" && principal.role !== "ROLE_CONSULTANT")
    throw new PermissionDeniedException();
}

export function requireRequestAccess(request: ConsultingRequest, principal: AuthPrincipal) {
  requireOperationalRole(principal);
  if (principal.role === "ROLE_CONSULTANT" && request.assignedConsultantId !== principal.userId)
    throw new NotFoundException();
}

/**
 * Consultant dual ASG: consulting_requests.assigned_consultant_id = actor AND
 * security_assessments.assigned_consultant_id = actor, plus request/assessment
 * employer linkage for every role.
 */
export function requireAssessmentAccess(
  row: { assessment: SecurityAssessment; request: ConsultingRequest },
  principal: AuthPrincipal,
) {
  requireRequestAccess(row.request, principal);
  if (
    row.assessment.employerId !== row.request.employerId ||
    (principal.role === "ROLE_CONSULTANT" &&
      row.assessment.assignedConsultantId !== principal.userId)
  )
    throw new NotFoundException();
}
