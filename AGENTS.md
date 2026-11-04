# AGENTS.md

## Language

- Write all deliverables in English: commit messages, PR/Issue text, review comments, code comments and JSDoc, and documentation (README, AGENTS.md, etc.).
- Exceptions: quotations, technical identifiers, external text and generated files.

## Overview

`discord-reader-mcp` is a read-only MCP server that exposes Discord REST API reads as 25 tools. It runs as an Azure Functions v4 app (Node.js, ESM, TypeScript) and uses the stateless Streamable HTTP transport of `@modelcontextprotocol/server`. It is a thin adapter: Discord's response is returned almost as-is, with an optional JMESPath projection.

## Commands

Package manager is pnpm (enforced by `preinstall`); the Node version is in `.node-version`.

```bash
pnpm install
pnpm build    # tsc -p tsconfig.build.json
pnpm test     # vitest run
pnpm lint     # eslint .
pnpm format   # prettier --write .
pnpm start    # build, then `func start` (needs Azure Functions Core Tools and local.settings.json)
```

There is no typecheck script; use `pnpm exec tsc --noEmit` (covers `src` and `test`). `node scripts/smoke-test.mjs` is a manual end-to-end check against a running local host. The only CI workflow (`.github/workflows/azure-functions-deploy.yml`) builds and deploys on push to `main`/`master`; it does not run lint or tests, so run them locally.

## Architecture

- `src/functions/mcp.ts`: the `/mcp` HTTP function (`authLevel: 'function'`); builds one `McpServer` per request. `src/functions/healthz.ts`: anonymous `GET /healthz`.
- `src/config.ts`: validates environment variables (`DISCORD_TOKEN`, `MCP_ALLOWED_ORIGINS`, `DISCORD_REQUEST_TIMEOUT_MS`, `LOG_LEVEL`).
- `src/http-guards.ts`: Origin allowlist check and CORS headers.
- `src/discord-adapter.ts`: `@discordjs/rest` wrapper; `GET` only, keeps HTTP status and headers.
- `src/tools/catalog.ts`: declarative tool definitions; `src/tools/registry.ts`: registers them and maps failures to local error envelopes.
- `src/projector.ts` (JMESPath), `src/pagination.ts`, `src/response-builder.ts`: response shaping.
- `src/logger.ts`: one JSON line per log call to stdout.
- `infra/`: Bicep template (Flex Consumption); see `infra/README.md`.
- Tests live in `test/` and mirror `src/`.

## Conventions

- Source is TypeScript with strict compiler options; imports use `.js` extensions (NodeNext).
- Formatting is Prettier (`.prettierrc.yml`); linting uses `@book000/eslint-config`.
- Dependencies are pinned to exact versions in `package.json` for runtime packages.
- Add a tool by adding an entry to `src/tools/catalog.ts` and a test; keep tools read-only (`GET`).
- Tool names and descriptions are exposed to MCP clients; changing them is a behavior change.

## Safety

- `DISCORD_TOKEN` comes only from environment variables (`local.settings.json` locally, a Function App setting in Azure, a `@secure()` Bicep parameter). Never commit it, and never put it in logs, errors or test fixtures.
- Config errors report field names only, never values. Do not pass secrets or raw Discord payloads to the logger.
- `/mcp` is protected only by the Function App host key plus the Origin check; keep both when changing the handler. Do not add write endpoints or non-`GET` Discord calls.
- Message content and member data are personal data: do not paste real Discord data into issues, tests or logs.
