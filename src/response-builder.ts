import type { DiscordHttpResult } from './discord-adapter.js'
import { paginationCalculators } from './pagination.js'
import { project } from './projector.js'

const EXPOSED_HEADERS = [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-reset-after',
  'x-ratelimit-bucket',
  'x-ratelimit-global',
  'x-ratelimit-scope',
  'retry-after',
] as const

/** MCP `tools/call` result envelope: `{ data, meta }` under `structuredContent`. */
export interface ToolEnvelope {
  // Index signature required for structural assignability to McpServer's
  // CallToolResult-shaped return type (registerTool's callback contract).
  [key: string]: unknown
  structuredContent: {
    data: unknown
    meta: Record<string, unknown>
    error?: { type: string; message: string }
  }
  content: []
  isError?: boolean
}

/** Filters Discord response headers down to the allowlisted rate-limit/semantic headers. */
function filterHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of EXPOSED_HEADERS) {
    const value = headers[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Builds the `{ data, meta }` envelope for a Discord HTTP result.
 * On a Discord error response (`status >= 400`), `data` is the raw error body
 * (JMESPath is not applied) and `isError` is set; pagination metadata is only
 * ever computed for successful responses.
 * @param toolName - The tool name, used to select a {@link paginationCalculators} entry.
 * @param result - The raw Discord HTTP result.
 * @param requestParams - The original tool call arguments (used by pagination calculators).
 * @param jmespathExpr - Optional JMESPath expression to project the response body.
 * @throws {JmespathError} When `jmespathExpr` is invalid (only on success responses).
 */
export function buildResponse(
  toolName: string,
  result: DiscordHttpResult,
  requestParams: Record<string, unknown>,
  jmespathExpr: string | undefined
): ToolEnvelope {
  const headers = filterHeaders(result.headers)

  if (result.status >= 400) {
    return {
      structuredContent: {
        data: result.body,
        meta: { http: { status: result.status, headers } },
      },
      content: [],
      isError: true,
    }
  }

  const meta: Record<string, unknown> = {
    http: { status: result.status, headers },
  }
  const next = paginationCalculators[toolName]?.(result.body, requestParams)
  if (next !== undefined) {
    meta.pagination = { next }
  }

  const data = project(result.body, jmespathExpr)
  return { structuredContent: { data, meta }, content: [] }
}

/** Builds a `data: null` error envelope for MCP-local failures — no Discord HTTP response exists. */
export function buildLocalError(type: string, message: string): ToolEnvelope {
  return {
    structuredContent: { data: null, meta: {}, error: { type, message } },
    content: [],
    isError: true,
  }
}
