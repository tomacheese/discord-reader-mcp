import { z } from "zod";
import { DiscordRequestError, type DiscordAdapter } from "../discordAdapter.js";
import { JmespathError } from "../projector.js";
import { buildLocalError, buildResponse, type ToolEnvelope } from "../responseBuilder.js";
import type { Logger } from "../logger.js";
import { toolCatalog, type ToolDef } from "./catalog.js";

export function buildToolHandler(adapter: DiscordAdapter, def: ToolDef, logger: Logger) {
  return async (rawArgs: Record<string, unknown>): Promise<ToolEnvelope> => {
    const { jmespath: jmespathExpr, ...args } = rawArgs;
    try {
      const validationError = def.validate?.(args);
      if (validationError !== undefined) {
        logger.warn("tool call failed: invalid arguments", { tool: def.name });
        return buildLocalError("INVALID_ARGUMENTS", validationError);
      }
      const result = await adapter.request("GET", def.path(args), def.query?.(args));
      const envelope = buildResponse(def.name, result, args, jmespathExpr as string | undefined);
      logger.info("tool call completed", { tool: def.name, status: result.status });
      return envelope;
    } catch (err) {
      if (err instanceof JmespathError) {
        logger.warn("tool call failed: invalid jmespath", { tool: def.name });
        return buildLocalError("INVALID_JMESPATH", err.message);
      }
      if (err instanceof DiscordRequestError) {
        const type = err.cause === "timeout" ? "DISCORD_REQUEST_TIMEOUT" : "DISCORD_REQUEST_FAILED";
        const message = err.cause === "timeout" ? "Discord request timed out" : "Discord request failed";
        logger.warn("tool call failed: transport error", { tool: def.name, cause: err.cause });
        return buildLocalError(type, message);
      }
      logger.error("tool call failed: unexpected error", { tool: def.name });
      return buildLocalError("INTERNAL_ERROR", "Internal processing failure");
    }
  };
}

// Minimal structural type for the MCP SDK server surface this registry needs —
// avoids importing SDK-internal types here; src/server.ts uses the real SDK type.
export interface McpServerLike {
  registerTool(
    name: string,
    config: { description: string; inputSchema: import("zod").ZodRawShape; annotations?: Record<string, unknown> },
    handler: (args: Record<string, unknown>) => Promise<ToolEnvelope>,
  ): void;
}

export function registerAllTools(server: McpServerLike, adapter: DiscordAdapter, logger: Logger): void {
  for (const def of toolCatalog) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: { ...def.inputShape, jmespath: z.string().optional() },
        annotations: { readOnlyHint: true },
      },
      buildToolHandler(adapter, def, logger),
    );
  }
}
