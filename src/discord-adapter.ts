import {
  REST,
  RequestMethod,
  DiscordAPIError,
  HTTPError,
} from '@discordjs/rest'
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
    public readonly cause: 'timeout' | 'network'
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
  body: ReadableStream | null
  json(): Promise<unknown>
}

/** The subset of an emitted `response` event's request info needed to correlate it to our call. */
interface EmittedRequestInfo {
  data: { signal?: AbortSignal }
}

/**
 * Minimal structural type for the subset of REST we call.
 * `queueRequest()` throws on Discord 4xx/5xx — it is not a raw, non-throwing
 * fetch despite its declared return type. Status/headers for error responses
 * are instead captured from the `response` event, which `@discordjs/rest`
 * emits for every request, success or error, with a cloned,
 * independently-readable ResponseLike. Correlating the event to a specific
 * call (required for concurrency safety) uses each call's own `AbortSignal`
 * as an identity token, never triggered to abort.
 */
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
  setMaxListeners?(n: number): unknown
}

/** Lowercases every header name into a plain record. */
function toHeaderRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of headers.entries()) out[key.toLowerCase()] = value
  return out
}

/**
 * Reads a captured response's JSON body. Returns `null` only for a genuinely
 * empty body (204 No Content); a malformed body on a non-empty response is
 * a real failure and is left to throw, rather than being silently
 * indistinguishable from a legitimate `null` result.
 */
async function readJsonBody(response: RawResponseLike): Promise<unknown> {
  if (response.status === 204) return null
  return response.json()
}

/**
 * Creates a {@link DiscordAdapter} backed by `@discordjs/rest`, configured
 * with `retries: 0` so 5xx/timeout/network failures are never retried locally.
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
  // A `response` listener is added/removed per request below, so concurrent
  // in-flight requests each hold their own listener at once — raise the cap
  // to avoid Node's default MaxListenersExceededWarning under load.
  rest.setMaxListeners?.(0)

  return {
    async request(_method, path, query) {
      const signal = new AbortController().signal
      let captured: RawResponseLike | undefined

      const onResponse = (
        request: EmittedRequestInfo,
        response: RawResponseLike
      ) => {
        if (request.data.signal === signal) {
          captured = response
        } else {
          // Not our request — best-effort release of the clone instead of
          // leaving it buffered. This runs synchronously inside REST's
          // `emit()`, so any throw here (e.g. a `.body` shape without
          // `.cancel`) would corrupt an unrelated concurrent request's
          // `queueRequest()` result — never let it escape.
          try {
            response.body?.cancel().catch(() => undefined)
          } catch {
            // ignored — see comment above
          }
        }
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

      // On a Discord 4xx/5xx, `@discordjs/rest` already read and parsed the
      // original response's body internally to build this error — re-reading
      // the cloned `captured` response's body at this point races with that
      // internal read and can throw (`assert(!stream[kConsume])`), so the
      // status/body come from the error itself, never from `captured.json()`.
      if (thrown instanceof DiscordAPIError) {
        return {
          body: thrown.rawError,
          status: thrown.status,
          headers: captured ? toHeaderRecord(captured.headers) : {},
        }
      }
      if (thrown instanceof HTTPError) {
        return {
          body: null,
          status: thrown.status,
          headers: captured ? toHeaderRecord(captured.headers) : {},
        }
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
      throw new DiscordRequestError(
        `Discord request failed (${cause}): ${message}`,
        cause
      )
    },
  }
}
