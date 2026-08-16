import { z } from "zod";

export class ConfigError extends Error {}

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  MCP_AUTH_TOKEN: z.string().min(1, "MCP_AUTH_TOKEN is required"),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  DISCORD_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export interface Config {
  discordToken: string;
  mcpAuthToken: string;
  allowedOrigins: string[];
  host: string;
  port: number;
  discordRequestTimeoutMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // ponytail: flatten() field paths only, never echo raw input values (avoids secret leakage)
    const fields = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
    throw new ConfigError(`Invalid configuration for: ${fields}`);
  }
  const v = parsed.data;
  return {
    discordToken: v.DISCORD_TOKEN,
    mcpAuthToken: v.MCP_AUTH_TOKEN,
    allowedOrigins: v.MCP_ALLOWED_ORIGINS
      ? v.MCP_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    host: v.HOST ?? "0.0.0.0",
    port: v.PORT ?? 8080,
    discordRequestTimeoutMs: v.DISCORD_REQUEST_TIMEOUT_MS ?? 30000,
    logLevel: v.LOG_LEVEL ?? "info",
  };
}
