import http from 'node:http'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { Config } from './config.js'
import type { Logger } from './logger.js'
import { createDiscordAdapter } from './discord-adapter.js'
import { registerAllTools } from './tools/registry.js'

/** Checks the `Authorization: Bearer <token>` header against the configured MCP auth token (spec §6.1). */
function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  return typeof header === 'string' && header === `Bearer ${token}`
}

/**
 * Validates the `Origin` header per spec §6.3: absent Origin passes; a
 * present Origin must match the allowlist (an empty allowlist denies it).
 */
function isOriginAllowed(
  req: http.IncomingMessage,
  allowedOrigins: string[]
): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const value = Array.isArray(origin) ? origin[0] : origin
  return allowedOrigins.includes(value)
}

/**
 * Builds the Node HTTP request listener: `GET /healthz` (unauthenticated,
 * no Discord call) and `POST /mcp` (Bearer + Origin guarded, delegating to
 * the MCP SDK's stateless Streamable HTTP handler).
 */
export function createApp(
  config: Config,
  logger: Logger
): http.RequestListener {
  const adapter = createDiscordAdapter(config)

  // Per-request factory: createMcpHandler calls this once per HTTP request in
  // stateless mode. Registration is cheap (closures over the shared adapter/logger),
  // so a fresh McpServer per request avoids sharing any state across requests.
  const mcpHandler = createMcpHandler(() => {
    const server = new McpServer({ name: 'discord-rest-mcp', version: '1.0.0' })
    registerAllTools(server, adapter, logger)
    return server
  })
  const nodeMcpHandler = toNodeHandler(mcpHandler)

  return (req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (req.url === '/mcp') {
      if (!isAuthorized(req, config.mcpAuthToken)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      if (!isOriginAllowed(req, config.allowedOrigins)) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'origin not allowed' }))
        return
      }
      nodeMcpHandler(req, res).catch((err: unknown) => {
        logger.error('unhandled MCP request error', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }
}

/** Loads configuration, starts the HTTP server, and wires graceful shutdown. */
async function main() {
  const { loadConfig } = await import('./config.js')
  const { createLogger } = await import('./logger.js')
  const config = loadConfig(process.env)
  const logger = createLogger(config.logLevel)
  const server = http.createServer(createApp(config, logger))
  server.listen(config.port, config.host, () => {
    logger.info('server listening', { host: config.host, port: config.port })
  })
  const shutdown = () => {
    logger.info('shutting down')
    // Closing the server lets the event loop drain and Node exit naturally
    // once no requests/handles remain open.
    server.close()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err)
    // eslint-disable-next-line unicorn/no-process-exit -- entrypoint: a startup failure must exit non-zero
    process.exit(1)
  })
}
