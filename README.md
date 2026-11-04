# discord-reader-mcp

A read-only Model Context Protocol (MCP) server that exposes Discord REST API read operations as MCP tools. It runs on Azure Functions (v4, Node.js).

It does not map the Discord API onto a custom high-level model; it is a thin adapter that returns Discord's response structure almost as-is. Every tool accepts an optional [JMESPath](https://jmespath.org/) projection so callers can control how many tokens are handed to the LLM.

## Tools

25 read-only tools are defined in `src/tools/catalog.ts`.

| Category | Tool                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| User     | `get_current_user`, `get_user`                                                                                                             |
| Guild    | `get_guilds`, `get_guild`, `get_guild_roles`, `get_guild_role_member_counts`, `get_guild_audit_log`, `get_guild_bans`, `get_guild_invites` |
| Channel  | `get_guild_channels`, `get_channel`, `get_channel_pins`                                                                                    |
| Member   | `get_guild_member`, `list_guild_members`, `search_guild_members`                                                                           |
| Message  | `get_channel_messages`, `search_guild_messages`, `get_channel_message`, `get_reactions`, `get_poll_answer_voters`                          |
| Thread   | `list_active_guild_threads`, `list_public_archived_threads`, `list_private_archived_threads`, `list_thread_members`                        |
| Event    | `list_scheduled_events`                                                                                                                    |

No write tools (sending messages, assigning roles, etc.) are provided; the Discord adapter only issues `GET` requests.

## Setup

### Requirements

- Node.js (see `.node-version` for the version)
- pnpm (`preinstall` enforces it via `only-allow pnpm`)
- Azure Functions Core Tools (for running locally; installed as a devDependency)

```bash
pnpm install
```

### Environment variables

For local runs, set them under `Values` in `local.settings.json` (git-ignored, not in the repository).

| Variable                     | Required | Description                                                        |
| ---------------------------- | -------- | ------------------------------------------------------------------ |
| `DISCORD_TOKEN`              | Yes      | Discord bot token                                                  |
| `MCP_ALLOWED_ORIGINS`        | No       | Comma-separated allowed origins (CORS and Origin check) for `/mcp` |
| `DISCORD_REQUEST_TIMEOUT_MS` | No       | Timeout for Discord API requests in ms (default 30000)             |
| `LOG_LEVEL`                  | No       | Log level: `debug`, `info` (default), `warn` or `error`            |

### Development commands

```bash
pnpm build   # compile with tsc
pnpm watch   # tsc in watch mode
pnpm start   # build, then start the local Azure Functions host
pnpm test    # vitest
pnpm lint    # eslint
pnpm format  # prettier --write
```

With the local host running (`pnpm start`), `node scripts/smoke-test.mjs` runs an end-to-end check against `http://127.0.0.1:7071/mcp` (set `FUNCTIONS_KEY` if the host enforces a key).

## Deployment

See [`infra/README.md`](./infra/README.md) for provisioning and deploying to Azure Functions (Flex Consumption). The `/mcp` endpoint is authenticated with the Function App's host key.

## License

[MIT](./LICENSE)
