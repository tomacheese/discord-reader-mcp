import { REST, RequestMethod } from '@discordjs/rest'
import type { Config } from './config.js'

/** Raw Discord HTTP response: status, lowercased headers, and parsed JSON body. */
export interface DiscordHttpResult {
  body: unknown
  status: number
  headers: Record<string, string>
}

/** Thrown for transport-level failures (timeout, network error) — never for Discord 4xx/5xx bodies. */
export class DiscordRequestError extends Error {
  constructor(
    message: string,
    public readonly cause: 'timeout' | 'network' | 'other'
  ) {
    super(message)
  }
}

/** Thin wrapper over `@discordjs/rest` preserving HTTP status/headers for every request. */
export interface DiscordAdapter {
  request(
    method: 'GET',
    path: string,
    query?: Record<string, unknown>
  ): Promise<DiscordHttpResult>
}

/** Converts a Discord query-parameter object (scalars and arrays) into a `URLSearchParams`. */
function toSearchParams(
  query?: Record<string, unknown>
): URLSearchParams | undefined {
  if (!query) return undefined
  const params = new URLSearchParams()
  const stringify = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, stringify(v))
    } else {
      params.append(key, stringify(value))
    }
  }
  return params
}

/** A raw HTTP response as emitted on `REST`'s `response` event (see {@link RestLike.on}). */
interface RawResponseLike {
  status: number
  headers: Headers
  json(): Promise<unknown>
}

/** The subset of an emitted `response` event's request info needed to correlate it to our call. */
interface EmittedRequestInfo {
  data: { signal?: AbortSignal }
}

// Minimal structural type for the subset of REST we call. `queueRequest()` throws
// on Discord 4xx/5xx (it is not a raw, non-throwing fetch despite its declared
// return type), so status/headers for error responses are instead captured from
// the `response` event, which `@discordjs/rest` emits for every request — success
// or error — with a cloned, independently-readable ResponseLike. Correlating the
// event to a specific call (required for concurrency safety — see spec §8.4) uses
// each call's own `AbortSignal` as an identity token, never triggered to abort.
interface RestLike {
  queueRequest(request: {
    method: RequestMethod
    fullRoute: `/${string}`
    query?: URLSearchParams
    signal?: AbortSignal
  }): Promise<unknown>
  on(
    event: 'response',
    listener: (request: EmittedRequestInfo, response: RawResponseLike) => void
  ): unknown
  off(
    event: 'response',
    listener: (request: EmittedRequestInfo, response: RawResponseLike) => void
  ): unknown
}

function toHeaderRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of headers.entries()) out[key.toLowerCase()] = value
  return out
}

/** Reads a captured response's JSON body, tolerating a non-JSON body (e.g. an upstream error page). */
async function readJsonBody(response: RawResponseLike): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Creates a {@link DiscordAdapter} backed by `@discordjs/rest`, configured with
 * `retries: 0` (spec §14.2) so 5xx/timeout/network failures are never retried locally.
 * @param config - `discordToken` and `discordRequestTimeoutMs` from {@link Config}.
 * @param restOverride - Test-only seam accepting a fake REST implementation.
 */
export function createDiscordAdapter(
  config: Pick<Config, 'discordToken' | 'discordRequestTimeoutMs'>,
  restOverride?: RestLike
): DiscordAdapter {
  const rest: RestLike =
    restOverride ??
    new REST({ timeout: config.discordRequestTimeoutMs, retries: 0 }).setToken(
      config.discordToken
    )

  return {
    async request(_method, path, query) {
      const signal = new AbortController().signal
      let captured: RawResponseLike | undefined

      const onResponse = (
        request: EmittedRequestInfo,
        response: RawResponseLike
      ) => {
        if (request.data.signal === signal) captured = response
      }
      rest.on('response', onResponse)

      let thrown: unknown
      try {
        await rest.queueRequest({
          method: RequestMethod.Get,
          fullRoute: path as `/${string}`,
          query: toSearchParams(query),
          signal,
        })
      } catch (err) {
        thrown = err
      } finally {
        rest.off('response', onResponse)
      }

      if (captured) {
        return {
          body: await readJsonBody(captured),
          status: captured.status,
          headers: toHeaderRecord(captured.headers),
        }
      }

      const message =
        thrown instanceof Error ? thrown.message : 'unknown transport error'
      const cause = /timeout|abort/i.test(message) ? 'timeout' : 'network'
      throw new DiscordRequestError(`Discord request failed: ${cause}`, cause)
    },
  }
}
