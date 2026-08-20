import { z } from 'zod'
import { DiscordRequestError, type DiscordAdapter } from '../discord-adapter.js'
import { JmespathError } from '../projector.js'
import {
  buildLocalError,
  buildResponse,
  type ToolEnvelope,
} from '../response-builder.js'
import type { Logger } from '../logger.js'
import { toolCatalog, type ToolDef } from './catalog.js'

/**
 * Builds the MCP `tools/call` handler for one {@link ToolDef}: validates
 * cross-field constraints, calls Discord, and maps every failure mode
 * (invalid arguments, invalid JMESPath, transport error) to a local error envelope.
 * @param adapter - The {@link DiscordAdapter} used to call Discord.
 * @param def - The tool definition to wrap.
 * @param logger - Logger for request-scoped, secret-free log lines.
 */
export function buildToolHandler(
  adapter: DiscordAdapter,
  def: ToolDef,
  logger: Logger
) {
  return async (rawArgs: Record<string, unknown>): Promise<ToolEnvelope> => {
    const { jmespath: jmespathExpr, ...args } = rawArgs
    try {
      const validationError = def.validate?.(args)
      if (validationError !== undefined) {
        logger.warn('tool call failed: invalid arguments', { tool: def.name })
        return buildLocalError('INVALID_ARGUMENTS', validationError)
      }
      const result = await adapter.request(
        'GET',
        def.path(args),
        def.query?.(args)
      )
      const envelope = buildResponse(
        def.name,
        result,
        args,
        jmespathExpr as string | undefined
      )
      if (result.status >= 400) {
        logger.warn('tool call completed', {
          tool: def.name,
          status: result.status,
        })
      } else {
        logger.info('tool call completed', {
          tool: def.name,
          status: result.status,
        })
      }
      return envelope
    } catch (err) {
      if (err instanceof JmespathError) {
        logger.warn('tool call failed: invalid jmespath', { tool: def.name })
        return buildLocalError('INVALID_JMESPATH', err.message)
      }
      if (err instanceof DiscordRequestError) {
        const type =
          err.kind === 'timeout'
            ? 'DISCORD_REQUEST_TIMEOUT'
            : 'DISCORD_REQUEST_FAILED'
        const message =
          err.kind === 'timeout'
            ? 'Discord request timed out'
            : 'Discord request failed'
        logger.warn('tool call failed: transport error', {
          tool: def.name,
          kind: err.kind,
          message: err.message,
        })
        return buildLocalError(type, message)
      }
      logger.error('tool call failed: unexpected error', {
        tool: def.name,
        message: err instanceof Error ? err.message : String(err),
      })
      return buildLocalError('INTERNAL_ERROR', 'Internal processing failure')
    }
  }
}

/**
 * Minimal structural type for the MCP SDK server surface this registry needs —
 * avoids importing SDK-internal types here; {@link ../functions/mcp.ts} passes the real SDK type.
 */
export interface McpServerLike {
  registerTool(
    name: string,
    config: {
      description: string
      inputSchema: import('zod').ZodRawShape
      annotations?: Record<string, unknown>
    },
    handler: (args: Record<string, unknown>) => Promise<ToolEnvelope>
  ): void
}

const jmespathField = { jmespath: z.string().optional() }

/**
 * Registers every entry of {@link toolCatalog} on `server`, in catalog order
 * (deterministic `tools/list` ordering), adding the common `jmespath` field.
 */
export function registerAllTools(
  server: McpServerLike,
  adapter: DiscordAdapter,
  logger: Logger
): void {
  for (const def of toolCatalog) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: { ...def.inputShape, ...jmespathField },
        annotations: { readOnlyHint: true },
      },
      buildToolHandler(adapter, def, logger)
    )
  }
}
