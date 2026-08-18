// Azure Function App: discord-reader-mcp
// Deploy target: existing resource group (this template does not create the resource group itself)
// Runtime: Azure Functions v4, Node.js 24 LTS, Flex Consumption (FC1)
//
// ponytail: started on Linux Consumption (Y1), but every Y1 site we created in
// this subscription/region (multiple plans, multiple storage accounts, even a
// throwaway sanity-check app) returned a persistent 503 with no app content —
// existing Windows/.NET Function Apps in the same region were unaffected, so
// this was scoped to Y1 Linux Consumption specifically. Switched to Flex
// Consumption, Azure's current recommended plan (Y1 also reaches EOL 2028-09-30).
@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Discord bot token used to call the Discord REST API')
@secure()
param discordToken string

@description('Comma-separated list of allowed CORS Origins for MCP requests (empty = none allowed)')
param mcpAllowedOrigins string = ''

@description('Discord REST request timeout in milliseconds (empty = app default of 30000)')
param discordRequestTimeoutMs string = ''

@description('Log level: fatal, error, warn, info, debug, or trace (empty = app default of info)')
param logLevel string = ''

var logAnalyticsName = 'log-discord-reader-mcp'
var appInsightsName = 'appi-discord-reader-mcp'
var storageAccountName = 'stdiscordreadermcp'
var appServicePlanName = 'asp-discord-reader-mcp-flex'
var functionAppName = 'func-discord-reader-mcp'
var deploymentContainerName = 'app-package-${functionAppName}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storageAccount
  name: 'default'
}

// Flex Consumption deploys code from a blob container instead of the classic
// WEBSITE_RUN_FROM_PACKAGE / content-share model.
resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

// ponytail: optional app settings only appear when a value is provided, so
// the Node config schema's z.coerce/z.enum().optional() fields see either a
// valid value or no env var at all — never an empty string that fails coercion.
var optionalAppSettings = concat(
  empty(mcpAllowedOrigins) ? [] : [{ name: 'MCP_ALLOWED_ORIGINS', value: mcpAllowedOrigins }],
  empty(discordRequestTimeoutMs) ? [] : [{ name: 'DISCORD_REQUEST_TIMEOUT_MS', value: discordRequestTimeoutMs }],
  empty(logLevel) ? [] : [{ name: 'LOG_LEVEL', value: logLevel }]
)

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  tags: {
    'hidden-link: /app-insights-resource-id': appInsights.id
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      ftpsState: 'FtpsOnly'
      minTlsVersion: '1.2'
      http20Enabled: false
      // The `/mcp` route's own OPTIONS handler never runs: the Functions
      // host answers CORS preflight itself before dispatch, using this
      // platform-level allowlist rather than the app's MCP_ALLOWED_ORIGINS
      // setting.
      cors: {
        allowedOrigins: empty(mcpAllowedOrigins)
          ? []
          : split(mcpAllowedOrigins, ',')
      }
      appSettings: concat(
        [
          {
            name: 'AzureWebJobsStorage'
            value: storageConnectionString
          }
          {
            name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
            value: appInsights.properties.ConnectionString
          }
          {
            name: 'DISCORD_TOKEN'
            value: discordToken
          }
        ],
        optionalAppSettings
      )
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageAccount.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'AzureWebJobsStorage'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '24'
      }
    }
  }
}
