import { z } from 'zod'
import { LEVEL_NAMES, type Level } from './logger.js'

/** Thrown when required environment variables are missing or invalid. */
export class ConfigError extends Error {}

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  MCP_AUTH_TOKEN: z.string().min(1, 'MCP_AUTH_TOKEN is required'),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  DISCORD_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(LEVEL_NAMES).optional(),
})

/** Normalized, validated application configuration. */
export interface Config {
  discordToken: string
  mcpAuthToken: string
  allowedOrigins: string[]
  discordRequestTimeoutMs: number
  logLevel: Level
}

/**
 * Loads and validates configuration from environment variables.
 * @param env - The source environment (typically `process.env`).
 * @returns The normalized {@link Config}.
 * @throws {ConfigError} When a required variable is missing or a value fails validation.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    // ponytail: field paths only, never echo raw input values (avoids secret leakage)
    const tree = z.treeifyError(parsed.error)
    const fields = Object.keys(tree.properties ?? {}).join(', ')
    throw new ConfigError(`Invalid configuration for: ${fields}`)
  }
  const v = parsed.data
  return {
    discordToken: v.DISCORD_TOKEN,
    mcpAuthToken: v.MCP_AUTH_TOKEN,
    allowedOrigins: v.MCP_ALLOWED_ORIGINS
      ? v.MCP_ALLOWED_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    discordRequestTimeoutMs: v.DISCORD_REQUEST_TIMEOUT_MS ?? 30_000,
    logLevel: v.LOG_LEVEL ?? 'info',
  }
}
