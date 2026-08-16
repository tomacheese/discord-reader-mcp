import { describe, it, expect, vi } from "vitest";
import { createDiscordAdapter, DiscordRequestError } from "../src/discordAdapter.js";

function fakeRest(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let call = 0;
  return {
    queueRequest: vi.fn(async () => {
      const r = responses[call++];
      return {
        status: r.status,
        headers: new Headers(r.headers ?? {}),
        async json() {
          return r.body;
        },
      };
    }),
  };
}

describe("createDiscordAdapter", () => {
  it("returns status/body/lowercased headers for a 2xx response", async () => {
    const rest = fakeRest([{ status: 200, body: { id: "1" }, headers: { "X-RateLimit-Remaining": "4" } }]);
    const adapter = createDiscordAdapter({ discordToken: "t", discordRequestTimeoutMs: 30000 }, rest);
    const result = await adapter.request("GET", "/users/@me");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "1" });
    expect(result.headers["x-ratelimit-remaining"]).toBe("4");
  });

  it("returns (not throws) on a 403 Discord error body", async () => {
    const rest = fakeRest([{ status: 403, body: { message: "Missing Permissions", code: 50013 } }]);
    const adapter = createDiscordAdapter({ discordToken: "t", discordRequestTimeoutMs: 30000 }, rest);
    const result = await adapter.request("GET", "/guilds/1/bans");
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ message: "Missing Permissions", code: 50013 });
  });

  it("throws DiscordRequestError on transport failure", async () => {
    const rest = { queueRequest: vi.fn().mockRejectedValue(new Error("network down")) };
    const adapter = createDiscordAdapter({ discordToken: "t", discordRequestTimeoutMs: 30000 }, rest);
    await expect(adapter.request("GET", "/users/@me")).rejects.toBeInstanceOf(DiscordRequestError);
  });

  it("passes query params through as a URLSearchParams", async () => {
    const rest = fakeRest([{ status: 200, body: [], headers: {} }]);
    const adapter = createDiscordAdapter({ discordToken: "t", discordRequestTimeoutMs: 30000 }, rest);
    await adapter.request("GET", "/users/@me/guilds", { limit: 5, with_counts: true });
    const call = rest.queueRequest.mock.calls[0][0] as { query?: URLSearchParams };
    expect(call.query?.get("limit")).toBe("5");
    expect(call.query?.get("with_counts")).toBe("true");
  });
});
