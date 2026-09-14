import { appConfig } from "../../config/app.config";

/**
 * The `__Host-` cookie prefix requires Secure + Path=/ + no Domain attribute,
 * which in turn requires HTTPS. Local development runs over plain HTTP, so the
 * prefix and the Secure attribute are dropped outside production while every
 * other security attribute (HttpOnly, SameSite=Lax, Path=/) is preserved
 * unchanged. This is an internal implementation decision: the approved docs
 * fix the production cookie contract exactly but do not specify a local-HTTP
 * development strategy.
 */
export const SESSION_COOKIE_NAME = appConfig.isProduction ? "__Host-csh_session" : "csh_session";
export const CSRF_COOKIE_NAME = appConfig.isProduction ? "__Host-csh_csrf" : "csh_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: appConfig.isProduction,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: appConfig.isProduction,
    sameSite: "lax" as const,
    path: "/",
  };
}
