# infra

Bicep template deploying `discord-reader-mcp` as an Azure Functions v4 app
(Node.js 24 LTS, Flex Consumption / FC1), into an **existing** resource
group:

- Log Analytics Workspace
- Application Insights (workspace-based)
- Storage Account (also holds the Flex Consumption deployment package container)
- App Service Plan (Linux, Flex Consumption / FC1)
- Function App (Linux, Node.js 24 runtime)

> Started on Linux Consumption (Y1), but every Y1 site created for this app
> came back a persistent 503 with no usable content — reproduced across
> multiple plans and storage accounts in this subscription/region, while
> existing Windows Function Apps nearby were unaffected. Moved to Flex
> Consumption, which is also Azure's currently recommended plan (Y1 reaches
> EOL 2028-09-30).

## Deploy

```bash
cd infra
az deployment group create \
  --resource-group <existing-resource-group-name> \
  --template-file main.bicep \
  --parameters main.bicepparam
```

The secret app setting (`DISCORD_TOKEN`) is declared as a `@secure()`
parameter with no default value. `main.bicepparam` reads it from an
environment variable — set `DISCORD_TOKEN` before deploying, or override
with `--parameters discordToken=<value>` on the command line.

Optional app settings (`MCP_ALLOWED_ORIGINS`, `DISCORD_REQUEST_TIMEOUT_MS`,
`LOG_LEVEL`) are omitted from the Function App entirely when left empty, so
the app falls back to its own defaults. `MCP_ALLOWED_ORIGINS` also drives the
Function App's platform-level CORS allowlist — the Functions host answers
`OPTIONS` preflight itself, ahead of the app's own `/mcp` handler, so the
app-level Origin check alone doesn't cover it.

Application code is deployed separately via
[`.github/workflows/azure-functions-deploy.yml`](../.github/workflows/azure-functions-deploy.yml)
(push to `main`/`master`, or manual `workflow_dispatch`) — this template only
provisions the infrastructure.

**If deploying manually** (`func azure functionapp publish` / `az functionapp
deploy`), install prod dependencies with
`pnpm install --prod --frozen-lockfile --config.node-linker=hoisted` first.
pnpm's default symlinked `node_modules` does not survive Kudu's zip
extraction — transitive deps resolve fine locally but come back "Cannot find
module" once deployed.

## App key

`/mcp` requires the Function App's host key (`authLevel: 'function'`) — the
only auth layer, chosen because ChatGPT's custom connector setup offers only
OAuth or no authentication, never a Bearer token. `OPTIONS` (CORS preflight)
is the only anonymous method. Fetch a key and append it to the URL
registered with clients:

```bash
az functionapp keys list \
  --resource-group <existing-resource-group-name> \
  --name func-discord-reader-mcp \
  --query "functionKeys.default" -o tsv
```

`https://func-discord-reader-mcp.azurewebsites.net/mcp?code=<key>`

## Required GitHub Secrets

| Secret Name              | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`        | Client ID of the Azure AD application used for OIDC authentication      |
| `AZURE_TENANT_ID`        | Azure AD tenant ID                                                      |
| `AZURE_SUBSCRIPTION_ID`  | Azure subscription ID of the deployment target                          |
| `AZURE_FUNCTIONAPP_NAME` | Name of the Function App to deploy to (matches `functionAppName` above) |

These are expected to be configured in the `production` environment of the
GitHub repository (see `environment: production` in the workflow).
