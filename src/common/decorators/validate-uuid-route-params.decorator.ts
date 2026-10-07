import { SetMetadata } from "@nestjs/common";

export const UUID_ROUTE_PARAMS_METADATA = "validation:uuid-route-params";

/**
 * Marks route parameters that must be validated as UUIDs before permission
 * guards resolve their database-backed resource context.
 */
export const ValidateUuidRouteParams = (...paramNames: string[]) =>
  SetMetadata(UUID_ROUTE_PARAMS_METADATA, paramNames);
