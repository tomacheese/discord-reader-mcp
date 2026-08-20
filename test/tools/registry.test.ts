import { describe, it, expect, vi } from 'vitest'
import { buildToolHandler } from '../../src/tools/registry.js'
import type { DiscordAdapter } from '../../src/discord-adapter.js'
import { DiscordRequestError } from '../../src/discord-adapter.js'
import { createLogger } from '../../src/logger.js'
import type { ToolDef } from '../../src/tools/catalog.js'

const def: ToolDef = {
  name: 'get_current_user',
  description: 'd',
  inputShape: {},
  path: () => '/users/@me',
}

describe('buildToolHandler', () => {
  it('returns a success envelope for a 2xx Discord response', async () => {
    const adapter: DiscordAdapter = {
      request: vi
        .fn()
        .mockResolvedValue({ status: 200, body: { id: '1' }, headers: {} }),
    }
    const handler = buildToolHandler(adapter, def, createLogger('error'))
    const result = await handler({})
    expect(result.structuredContent.data).toEqual({ id: '1' })
    expect(result.isError).toBeUndefined()
  })

  it('maps a timeout DiscordRequestError to a local DISCORD_REQUEST_TIMEOUT error envelope', async () => {
    const adapter: DiscordAdapter = {
      request: vi
        .fn()
        .mockRejectedValue(
          new DiscordRequestError('Discord request failed: timeout', 'timeout')
        ),
    }
    const handler = buildToolHandler(adapter, def, createLogger('error'))
    const result = await handler({})
    expect(result.isError).toBe(true)
    expect(result.structuredContent.error?.type).toBe('DISCORD_REQUEST_TIMEOUT')
  })

  it('maps an invalid jmespath expression to a local INVALID_JMESPATH error envelope', async () => {
    const adapter: DiscordAdapter = {
      request: vi
        .fn()
        .mockResolvedValue({ status: 200, body: { id: '1' }, headers: {} }),
    }
    const handler = buildToolHandler(adapter, def, createLogger('error'))
    const result = await handler({ jmespath: 'id[' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent.error?.type).toBe('INVALID_JMESPATH')
  })

  it('short-circuits with INVALID_ARGUMENTS and never calls Discord when def.validate() fails', async () => {
    const request = vi.fn()
    const adapter: DiscordAdapter = { request }
    const defWithValidate: ToolDef = {
      ...def,
      validate: () => 'at most one of around, before, after may be set',
    }
    const handler = buildToolHandler(
      adapter,
      defWithValidate,
      createLogger('error')
    )
    const result = await handler({ before: '1', after: '2' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent.error?.type).toBe('INVALID_ARGUMENTS')
    expect(request).not.toHaveBeenCalled()
  })
})
