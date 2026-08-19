import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// /mcp is gated by the Azure Function App host key (authLevel: 'function'), not
// an app-level Bearer token — see infra/README.md's "App key" section. `func
// start` does not enforce this locally, so the key is only appended when set.
const functionKey = process.env.FUNCTIONS_KEY
const url = new URL('http://127.0.0.1:7071/mcp')
if (functionKey) url.searchParams.set('code', functionKey)

const transport = new StreamableHTTPClientTransport(url)
const client = new Client({ name: 'smoke-test', version: '1.0.0' })
await client.connect(transport)

const tools = await client.listTools()
console.log(`tools/list: ${tools.tools.length} tools`)
if (tools.tools.length !== 25)
  throw new Error(`expected 25 tools, got ${tools.tools.length}`)

const me = await client.callTool({ name: 'get_current_user', arguments: {} })
console.log('get_current_user:', JSON.stringify(me.structuredContent))
if (me.isError) throw new Error('get_current_user returned isError')
if (!me.structuredContent?.data?.id)
  throw new Error('get_current_user missing data.id')

const guilds = await client.callTool({
  name: 'get_guilds',
  arguments: { limit: 5 },
})
console.log('get_guilds:', JSON.stringify(guilds.structuredContent))
if (guilds.isError) throw new Error('get_guilds returned isError')

const projected = await client.callTool({
  name: 'get_guilds',
  arguments: { limit: 5, jmespath: '[].name' },
})
console.log(
  'get_guilds (projected):',
  JSON.stringify(projected.structuredContent)
)
if (!Array.isArray(projected.structuredContent?.data))
  throw new Error('jmespath projection did not return an array')

const badJmespath = await client.callTool({
  name: 'get_current_user',
  arguments: { jmespath: 'id[' },
})
console.log('invalid jmespath:', JSON.stringify(badJmespath.structuredContent))
if (
  !badJmespath.isError ||
  badJmespath.structuredContent?.error?.type !== 'INVALID_JMESPATH'
) {
  throw new Error('invalid jmespath did not produce INVALID_JMESPATH error')
}

const badUser = await client.callTool({
  name: 'get_user',
  arguments: { user_id: '1' },
})
console.log(
  'get_user(unknown id):',
  JSON.stringify(badUser.structuredContent),
  'isError:',
  badUser.isError
)
if (!badUser.isError || badUser.structuredContent?.meta?.http?.status !== 404) {
  throw new Error('expected a 404 Discord error to pass through with isError')
}

console.log('SMOKE TEST PASSED')
await client.close()
