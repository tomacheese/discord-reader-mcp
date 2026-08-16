import type { DiscordHttpResult } from "./discordAdapter.js";
import { paginationCalculators } from "./pagination.js";
import { project } from "./projector.js";

const EXPOSED_HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-reset-after",
  "x-ratelimit-bucket",
  "x-ratelimit-global",
  "x-ratelimit-scope",
  "retry-after",
] as const;

export interface ToolEnvelope {
  structuredContent: {
    data: unknown;
    meta: Record<string, unknown>;
    error?: { type: string; message: string };
  };
  content: [];
  isError?: boolean;
}

function filterHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of EXPOSED_HEADERS) {
    if (headers[key] !== undefined) out[key] = headers[key];
  }
  return out;
}

export function buildResponse(
  toolName: string,
  result: DiscordHttpResult,
  requestParams: Record<string, unknown>,
  jmespathExpr: string | undefined,
): ToolEnvelope {
  const headers = filterHeaders(result.headers);

  if (result.status >= 400) {
    return {
      structuredContent: { data: result.body, meta: { http: { status: result.status, headers } } },
      content: [],
      isError: true,
    };
  }

  const meta: Record<string, unknown> = { http: { status: result.status, headers } };
  const next = paginationCalculators[toolName]?.(result.body, requestParams);
  if (next !== undefined) {
    meta.pagination = { next };
  }

  const data = project(result.body, jmespathExpr);
  return { structuredContent: { data, meta }, content: [] };
}

export function buildLocalError(type: string, message: string): ToolEnvelope {
  return {
    structuredContent: { data: null, meta: {}, error: { type, message } },
    content: [],
    isError: true,
  };
}
