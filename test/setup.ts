// Azure Functions auto-registers `src/functions/*.ts` by importing them, so
// `src/functions/mcp.ts` reads `process.env` (via loadConfig) as a module-load
// side effect. Placeholder values here let that import succeed under vitest;
// tests exercising real behavior use `createMcpFunction` with explicit config.
process.env.DISCORD_TOKEN ??= 'test-placeholder-token'
