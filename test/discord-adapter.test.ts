import { describe, it, expect, vi } from 'vitest'
import { DiscordAPIError, HTTPError } from '@discordjs/rest'
import {
  createDiscordAdapter,
  DiscordRequestError,
} from '../src/discord-adapter.js'

type ResponseListener = (
  request: { data: { signal?: AbortSignal } },
  response: {
    status: number
    headers: Headers
    body: ReadableStream | null
    json(): Promise<unknown>
  }
) => void

/**
 * A fake mimicking the `@discordjs/rest` behavior this adapter depends on:
 * `queueRequest()` throws on a non-2xx status (like the real client), but the
 * `response` event fires first, for every call, with the raw status/headers/body.
 */
function fakeRest(
  responses: {
    status: number
    body: unknown
    headers?: Record<string, string>
  }[]
) {
  let call = 0
  const listeners: ResponseListener[] = []
  return {
    on: vi.fn((_event: 'response', listener: ResponseListener) => {
      listeners.push(listener)
    }),
    off: vi.fn((_event: 'response', listener: ResponseListener) => {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    }),
    queueRequest: vi.fn(
      (request: { query?: URLSearchParams; signal?: AbortSignal }) => {
        const r = responses[call]
        call++
        if (!r)
          throw new Error(`fakeRest: no response configured for call ${call}`)
        const response = {
          status: r.status,
          headers: new Headers(r.headers ?? {}),
          body: null,
          // A real `@discordjs/rest` internally reads the body while
          // building its thrown error; re-reading `json()` here on a 4xx/5xx
          // response would race with that (see the "does not call json()"
          // test below), so the fake fails loudly if the adapter ever does.
          json: () =>
            r.status >= 400
              ? Promise.reject(
                  new Error(
                    'adapter must not read the body on an error response'
                  )
                )
              : Promise.resolve(r.body),
        }
        for (const listener of listeners) listener({ data: request }, response)
        if (r.status >= 500) {
          return Promise.reject(
            new HTTPError(r.status, 'Error', 'GET', 'https://discord.com', {})
          )
        }
        if (r.status >= 400) {
          return Promise.reject(
            new DiscordAPIError(
              r.body as never,
              (r.body as { code?: number }).code ?? 0,
              r.status,
              'GET',
              'https://discord.com',
              {}
            )
          )
        }
        return Promise.resolve(r.body)
      }
    ),
  }
}

describe('createDiscordAdapter', () => {
  it('returns status/body/lowercased headers for a 2xx response', async () => {
    const rest = fakeRest([
      {
        status: 200,
        body: { id: '1' },
        headers: { 'X-RateLimit-Remaining': '4' },
      },
    ])
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    const result = await adapter.request('GET', '/users/@me')
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: '1' })
    expect(result.headers['x-ratelimit-remaining']).toBe('4')
  })

  it('returns (not throws) on a 403 Discord error body, read from the thrown DiscordAPIError rather than re-reading the response', async () => {
    const rest = fakeRest([
      { status: 403, body: { message: 'Missing Permissions', code: 50_013 } },
    ])
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    const result = await adapter.request('GET', '/guilds/1/bans')
    expect(result.status).toBe(403)
    expect(result.body).toEqual({
      message: 'Missing Permissions',
      code: 50_013,
    })
  })

  it('returns (not throws) on a 500 response, with a null body', async () => {
    const rest = fakeRest([{ status: 500, body: null }])
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    const result = await adapter.request('GET', '/guilds/1/bans')
    expect(result.status).toBe(500)
    expect(result.body).toBeNull()
  })

  it('throws DiscordRequestError on transport failure', async () => {
    const rest = {
      on: vi.fn(),
      off: vi.fn(),
      queueRequest: vi.fn().mockRejectedValue(new Error('network down')),
    }
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    await expect(adapter.request('GET', '/users/@me')).rejects.toBeInstanceOf(
      DiscordRequestError
    )
  })

  it('returns body: null for a 204 response without reading json()', async () => {
    const rest = fakeRest([{ status: 204, body: undefined, headers: {} }])
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    const result = await adapter.request('GET', '/users/@me')
    expect(result.body).toBeNull()
  })

  it('propagates a json() parse failure on a non-204 response instead of masking it as null', async () => {
    let listener: ResponseListener | undefined
    const rest = {
      on: vi.fn((_event: 'response', l: ResponseListener) => {
        listener = l
      }),
      off: vi.fn(),
      queueRequest: vi.fn((request: { signal?: AbortSignal }) => {
        listener?.(
          { data: { signal: request.signal } },
          {
            status: 200,
            headers: new Headers(),
            body: null,
            json: () => Promise.reject(new Error('invalid json')),
          }
        )
        return Promise.resolve()
      }),
    }
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    await expect(adapter.request('GET', '/users/@me')).rejects.toThrow(
      'invalid json'
    )
  })

  it('ignores a foreign response event whose body lacks .cancel(), without corrupting the in-flight request', async () => {
    let listener: ResponseListener | undefined
    const rest = {
      on: vi.fn((_event: 'response', l: ResponseListener) => {
        listener = l
      }),
      off: vi.fn(),
      queueRequest: vi.fn((request: { signal?: AbortSignal }) => {
        // A response for a different, unrelated in-flight call arrives first —
        // its `body` is a plain object without `.cancel`, unlike a real
        // ReadableStream, exercising the defensive guard.
        listener?.(
          { data: { signal: new AbortController().signal } },
          {
            status: 200,
            headers: new Headers(),
            body: {} as ReadableStream,
            json: () => Promise.resolve({ foreign: true }),
          }
        )
        listener?.(
          { data: { signal: request.signal } },
          {
            status: 200,
            headers: new Headers(),
            body: null,
            json: () => Promise.resolve({ mine: true }),
          }
        )
        return Promise.resolve()
      }),
    }
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    const result = await adapter.request('GET', '/users/@me')
    expect(result.body).toEqual({ mine: true })
  })

  it('passes query params through as a URLSearchParams', async () => {
    const rest = fakeRest([{ status: 200, body: [], headers: {} }])
    const adapter = createDiscordAdapter(
      { discordToken: 't', discordRequestTimeoutMs: 30_000 },
      rest
    )
    await adapter.request('GET', '/users/@me/guilds', {
      limit: 5,
      with_counts: true,
    })
    const firstCall = rest.queueRequest.mock.calls[0]
    if (!firstCall) throw new Error('expected queueRequest to have been called')
    const [call] = firstCall
    expect(call.query?.get('limit')).toBe('5')
    expect(call.query?.get('with_counts')).toBe('true')
  })
})
