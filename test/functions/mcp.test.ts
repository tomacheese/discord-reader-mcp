import { describe, it, expect } from 'vitest'
import type { HttpRequest } from '@azure/functions'
import { createMcpFunction } from '../../src/functions/mcp.js'
import { createLogger } from '../../src/logger.js'

const config = {
  discordToken: 'fake',
  allowedOrigins: ['https://allowed.example'],
  discordRequestTimeoutMs: 30_000,
}

/** Builds a minimal `HttpRequest`-shaped fake — only the fields {@link createMcpFunction} reads. */
function fakeRequest(init: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
}): HttpRequest {
  return {
    method: init.method ?? 'POST',
    url: init.url ?? 'http://localhost/mcp',
    headers: new Headers(init.headers ?? {}),
    body: init.body ? new Blob([init.body]).stream() : null,
  } as unknown as HttpRequest
}

describe('createMcpFunction', () => {
  const mcp = createMcpFunction(config, createLogger('error'))

  it('rejects a disallowed Origin, with no CORS headers echoed back', async () => {
    const result = await mcp(
      fakeRequest({ headers: { origin: 'https://evil.example' } })
    )
    expect(result.status).toBe(403)
    expect(
      (result.headers as Record<string, string> | undefined)?.[
        'Access-Control-Allow-Origin'
      ]
    ).toBeUndefined()
  })

  it('echoes an allowed Origin as Access-Control-Allow-Origin', async () => {
    const result = await mcp(
      fakeRequest({ headers: { origin: 'https://allowed.example' } })
    )
    expect((result.headers as Headers).get('Access-Control-Allow-Origin')).toBe(
      'https://allowed.example'
    )
  })
})
