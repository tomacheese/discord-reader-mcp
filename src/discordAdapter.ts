import { REST, RequestMethod } from "@discordjs/rest";
import type { Config } from "./config.js";

export interface DiscordHttpResult {
  body: unknown;
  status: number;
  headers: Record<string, string>;
}

export class DiscordRequestError extends Error {
  constructor(
    message: string,
    public readonly cause: "timeout" | "network" | "other",
  ) {
    super(message);
  }
}

export interface DiscordAdapter {
  request(method: "GET", path: string, query?: Record<string, unknown>): Promise<DiscordHttpResult>;
}

function toSearchParams(query?: Record<string, unknown>): URLSearchParams | undefined {
  if (!query) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

// Minimal structural type for the subset of REST#queueRequest we call — avoids
// importing the @internal-tagged InternalRequest type directly.
interface RestLike {
  queueRequest(request: {
    method: RequestMethod;
    fullRoute: `/${string}`;
    query?: URLSearchParams;
  }): Promise<{
    status: number;
    headers: Headers;
    json(): Promise<unknown>;
  }>;
}

export function createDiscordAdapter(
  config: Pick<Config, "discordToken" | "discordRequestTimeoutMs">,
  restOverride?: RestLike,
): DiscordAdapter {
  const rest: RestLike =
    restOverride ??
    (new REST({ timeout: config.discordRequestTimeoutMs, retries: 0 }).setToken(
      config.discordToken,
    ) as unknown as RestLike);

  return {
    async request(method, path, query) {
      // rest.queueRequest() returns the raw ResponseLike per call (status/headers/json()),
      // never throwing on Discord 4xx/5xx — only on transport-level failures — and never
      // sharing state across concurrent calls (see @discordjs/rest REST#queueRequest()).
      let raw: { status: number; headers: Headers; json(): Promise<unknown> };
      try {
        raw = await rest.queueRequest({
          method: method === "GET" ? RequestMethod.Get : (method as RequestMethod),
          fullRoute: path as `/${string}`,
          query: toSearchParams(query),
        });
      } catch (err) {
        const message = (err as Error).message ?? "unknown transport error";
        const cause = /timeout/i.test(message) ? "timeout" : "network";
        throw new DiscordRequestError(`Discord request failed: ${cause}`, cause);
      }

      const headers: Record<string, string> = {};
      for (const [key, value] of raw.headers.entries()) {
        headers[key.toLowerCase()] = value;
      }
      const body = await raw.json();

      return { body, status: raw.status, headers };
    },
  };
}
