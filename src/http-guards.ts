/** The subset of the Fetch `Headers` interface these guards need — satisfied by both a real `Headers` and Azure Functions' `HttpRequest.headers`. */
export interface HeadersLike {
  get(name: string): string | null
}

/**
 * Validates the `Origin` header: absent Origin passes; a present Origin
 * must match the allowlist (an empty allowlist denies it).
 */
export function isOriginAllowed(
  headers: HeadersLike,
  allowedOrigins: string[]
): boolean {
  const origin = headers.get('origin')
  if (origin === null) return true
  return allowedOrigins.includes(origin)
}

/** Methods the `/mcp` route accepts, echoed on CORS preflight. */
export const CORS_ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS'

/** Request headers MCP clients send, echoed on CORS preflight. */
export const CORS_ALLOWED_HEADERS =
  'authorization, content-type, mcp-session-id, mcp-protocol-version'

/**
 * Builds CORS response headers for a request whose `Origin` is present and
 * allowed — empty otherwise, which leaves the response with no CORS headers
 * at all (same-origin/non-browser callers, who never check for them).
 */
export function corsHeaders(
  headers: HeadersLike,
  allowedOrigins: string[]
): Record<string, string> {
  const origin = headers.get('origin')
  if (origin === null || !allowedOrigins.includes(origin)) return {}
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
}
