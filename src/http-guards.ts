import { createHash, timingSafeEqual } from 'node:crypto'

/** The subset of the Fetch `Headers` interface these guards need — satisfied by both a real `Headers` and Azure Functions' `HttpRequest.headers`. */
export interface HeadersLike {
  get(name: string): string | null
}

/** Hashes a string so two values of differing length can still be compared in constant time. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Checks the `Authorization: Bearer <token>` header against the configured MCP auth token, in constant time. */
export function isAuthorized(headers: HeadersLike, token: string): boolean {
  const header = headers.get('authorization')
  if (header === null) return false
  return timingSafeEqual(digest(header), digest(`Bearer ${token}`))
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
