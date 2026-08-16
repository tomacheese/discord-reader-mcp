import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createApp } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { createLogger } from '../src/logger.js'

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  const config = loadConfig({
    DISCORD_TOKEN: 'fake',
    MCP_AUTH_TOKEN: 'secret-token',
    MCP_ALLOWED_ORIGINS: 'https://allowed.example',
  })
  server = http.createServer(createApp(config, createLogger('error')))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(
  () =>
    new Promise<void>((resolve) =>
      server.close(() => {
        resolve()
      })
    )
)

describe('server auth/origin/health', () => {
  it('GET /healthz returns ok without auth', async () => {
    const res = await fetch(`${baseUrl}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('POST /mcp without Authorization returns 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('POST /mcp with wrong Bearer token returns 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('POST /mcp with disallowed Origin returns 403 even with valid Bearer', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-token',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })
})
