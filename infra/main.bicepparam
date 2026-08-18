using 'main.bicep'

param discordToken = readEnvironmentVariable('DISCORD_TOKEN', '')
param mcpAllowedOrigins = readEnvironmentVariable('MCP_ALLOWED_ORIGINS', '')
param discordRequestTimeoutMs = readEnvironmentVariable('DISCORD_REQUEST_TIMEOUT_MS', '')
param logLevel = readEnvironmentVariable('LOG_LEVEL', '')
