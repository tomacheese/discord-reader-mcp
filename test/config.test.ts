import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../src/config.js";

describe("loadConfig", () => {
  it("loads required vars and applies defaults", () => {
    const cfg = loadConfig({
      DISCORD_TOKEN: "tok",
      MCP_AUTH_TOKEN: "secret",
    });
    expect(cfg.discordToken).toBe("tok");
    expect(cfg.mcpAuthToken).toBe("secret");
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(8080);
    expect(cfg.discordRequestTimeoutMs).toBe(30000);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.allowedOrigins).toEqual([]);
  });

  it("parses comma-separated origins and numeric overrides", () => {
    const cfg = loadConfig({
      DISCORD_TOKEN: "tok",
      MCP_AUTH_TOKEN: "secret",
      MCP_ALLOWED_ORIGINS: "https://a.example,https://b.example",
      PORT: "9090",
      DISCORD_REQUEST_TIMEOUT_MS: "5000",
      LOG_LEVEL: "debug",
    });
    expect(cfg.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(cfg.port).toBe(9090);
    expect(cfg.discordRequestTimeoutMs).toBe(5000);
    expect(cfg.logLevel).toBe("debug");
  });

  it("throws ConfigError without leaking secret value when DISCORD_TOKEN missing", () => {
    try {
      loadConfig({ MCP_AUTH_TOKEN: "secret" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).not.toContain("secret");
    }
  });
});
