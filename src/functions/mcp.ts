import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { Config } from '../config.js'
import { loadConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { createLogger } from '../logger.js'
import { createDiscordAdapter } from '../discord-adapter.js'
import { registerAllTools } from '../tools/registry.js'
import {
  isOriginAllowed,
  corsHeaders,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
} from '../http-guards.js'

/** Converts an Azure Functions request into a Web-standard `Request` for the MCP handler. */
function toWebRequest(request: HttpRequest): Request {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit)
}

/**
 * Converts the MCP handler's Web-standard `Response` into an Azure
 * `HttpResponseInit`, merging in the CORS headers computed for this request.
 */
async function toFunctionResponse(
  response: Response,
  extraHeaders: Record<string, string>
): Promise<HttpResponseInit> {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value)
  }
  return {
    status: response.status,
    headers,
    body: Buffer.from(await response.arrayBuffer()),
  }
}

/**
 * Builds the `/mcp` handler (`GET`/`POST`/`DELETE`), app-key (via
 * `authLevel: 'function'` on registration) + Origin guarded, delegating to
 * the MCP SDK's stateless Streamable HTTP handler.
 *
 * ponytail: the app key is the only auth layer — ChatGPT's custom connector
 * only offers OAuth or no-auth, never a Bearer token, so a second app-level
 * check would just lock ChatGPT out. Add one back if a client that can send
 * an Authorization header needs finer-grained access than the app key gives.
 * @param config - `allowedOrigins` plus the fields {@link createDiscordAdapter} needs.
 * @param logger - Logger for request-scoped, secret-free log lines.
 */
export function createMcpFunction(
  config: Pick<
    Config,
    'allowedOrigins' | 'discordToken' | 'discordRequestTimeoutMs'
  >,
  logger: Logger
) {
  const adapter = createDiscordAdapter(config)

  // Per-request factory: createMcpHandler calls this once per HTTP request in
  // stateless mode, so a fresh McpServer per invocation never shares state
  // across concurrent Function executions.
  const mcpHandler = createMcpHandler(
    () => {
      const server = new McpServer({
        name: 'discord-rest-mcp',
        version: '1.0.0',
      })
      registerAllTools(server, adapter, logger)
      return server
    },
    // ponytail: this tool set never emits server-initiated notifications, so
    // every exchange is a single JSON response. Functions HTTP streaming is
    // intentionally left disabled, hence 'json' over 'auto'/'sse'. Note:
    // 'json' mode silently drops a notification if one is ever emitted
    // mid-call — it does not error — so this is a deliberate trade-off, not
    // a safety net.
    {
      responseMode: 'json',
      onerror: (error) => {
        logger.error('mcp handler error', { message: error.message })
      },
    }
  )

  return async function mcp(request: HttpRequest): Promise<HttpResponseInit> {
    const cors = corsHeaders(request.headers, config.allowedOrigins)
    if (!isOriginAllowed(request.headers, config.allowedOrigins)) {
      return {
        status: 403,
        headers: cors,
        jsonBody: { error: 'origin not allowed' },
      }
    }
    try {
      const response = await mcpHandler.fetch(toWebRequest(request))
      return await toFunctionResponse(response, cors)
    } catch (err) {
      logger.error('unhandled MCP request error', {
        message: err instanceof Error ? err.message : String(err),
      })
      return {
        status: 500,
        headers: cors,
        jsonBody: { error: 'internal error' },
      }
    }
  }
}

const config = loadConfig(process.env)
const logger = createLogger(config.logLevel)

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Azure Functions v4 discovers functions by importing this file and running app.http() as a side effect
app.http('mcp', {
  methods: ['GET', 'POST', 'DELETE'],
  // App-key gated: callers must supply the Function App's host key (?code=
  // or x-functions-key) — the only auth layer, see createMcpFunction's doc.
  authLevel: 'function',
  route: 'mcp',
  handler: createMcpFunction(config, logger),
})

// eslint-disable-next-line unicorn/no-top-level-side-effects -- see above
app.http('mcpPreflight', {
  methods: ['OPTIONS'],
  // CORS preflight never carries the app key, so this route stays
  // anonymous — it only ever returns the CORS headers below.
  authLevel: 'anonymous',
  route: 'mcp',
  handler: (request) => {
    const cors = corsHeaders(request.headers, config.allowedOrigins)
    return {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
      },
    }
  },
})
