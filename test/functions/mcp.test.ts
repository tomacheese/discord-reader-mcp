import { describe, it, expect } from 'vitest'
import type { HttpRequest } from '@azure/functions'
import { createMcpFunction } from '../../src/functions/mcp.js'
import { createLogger } from '../../src/logger.js'

const config = {
  discordToken: 'fake',
  mcpAuthToken: 'secret-token',
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

  it('rejects a request with no Authorization header', async () => {
    const result = await mcp(fakeRequest({}))
    expect(result.status).toBe(401)
  })

  it('rejects a request with the wrong Bearer token', async () => {
    const result = await mcp(
      fakeRequest({ headers: { authorization: 'Bearer wrong' } })
    )
    expect(result.status).toBe(401)
  })

  it('rejects a disallowed Origin even with a valid Bearer token', async () => {
    const result = await mcp(
      fakeRequest({
        headers: {
          authorization: 'Bearer secret-token',
          origin: 'https://evil.example',
        },
      })
    )
    expect(result.status).toBe(403)
  })
})
