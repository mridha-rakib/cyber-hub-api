/**
 * Minimal Cookie header parser. No `cookie-parser` dependency is installed in
 * this project, and setting cookies via Express's built-in `res.cookie()`
 * does not require one either — only reading incoming cookies does, so this
 * small parser avoids adding a dependency for that alone.
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}
