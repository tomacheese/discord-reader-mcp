import { describe, it, expect } from 'vitest'
import { buildResponse, buildLocalError } from '../src/response-builder.js'
import { JmespathError } from '../src/projector.js'

describe('buildResponse', () => {
  it('builds a success envelope with filtered headers and no pagination when calculator absent', () => {
    const env = buildResponse(
      'get_current_user',
      {
        status: 200,
        body: { id: '1' },
        headers: { 'x-ratelimit-remaining': '4', 'x-forwarded-for': '1.2.3.4' },
      },
      {},
      undefined
    )
    expect(env.structuredContent.data).toEqual({ id: '1' })
    expect(env.structuredContent.meta).toEqual({
      http: { status: 200, headers: { 'x-ratelimit-remaining': '4' } },
    })
    expect(env.content).toEqual([{ type: 'text', text: '{"id":"1"}' }])
    expect(env.isError).toBeUndefined()
  })

  it('adds meta.pagination.next when a calculator is registered and returns a value', () => {
    const env = buildResponse(
      'get_channel_messages',
      { status: 200, body: [{ id: '300' }, { id: '100' }], headers: {} },
      { limit: 2 },
      undefined
    )
    expect(env.structuredContent.meta.pagination).toEqual({
      next: { before: '100' },
    })
  })

  it('keeps meta.pagination.next even when jmespath strips the id field from data', () => {
    const env = buildResponse(
      'get_channel_messages',
      {
        status: 200,
        body: [
          { id: '300', content: 'a' },
          { id: '100', content: 'b' },
        ],
        headers: {},
      },
      { limit: 2 },
      '[].content'
    )
    expect(env.structuredContent.data).toEqual(['a', 'b'])
    expect(env.structuredContent.meta.pagination).toEqual({
      next: { before: '100' },
    })
  })

  it('marks isError and skips jmespath on Discord error responses', () => {
    const env = buildResponse(
      'get_guild_bans',
      {
        status: 403,
        body: { message: 'Missing Permissions', code: 50_013 },
        headers: {},
      },
      {},
      '[].id'
    )
    expect(env.isError).toBe(true)
    expect(env.structuredContent.data).toEqual({
      message: 'Missing Permissions',
      code: 50_013,
    })
    expect(env.structuredContent.meta.pagination).toBeUndefined()
  })

  it('throws JmespathError for an invalid expression on a success response', () => {
    expect(() =>
      buildResponse(
        'get_current_user',
        { status: 200, body: { id: '1' }, headers: {} },
        {},
        'id['
      )
    ).toThrow(JmespathError)
  })

  it('buildLocalError produces a data:null envelope with isError and stable type', () => {
    const env = buildLocalError(
      'DISCORD_REQUEST_TIMEOUT',
      'Discord request timed out'
    )
    expect(env.structuredContent).toEqual({
      data: null,
      meta: {},
      error: {
        type: 'DISCORD_REQUEST_TIMEOUT',
        message: 'Discord request timed out',
      },
    })
    expect(env.isError).toBe(true)
    expect(env.content).toEqual([
      {
        type: 'text',
        text: '{"error":{"type":"DISCORD_REQUEST_TIMEOUT","message":"Discord request timed out"}}',
      },
    ])
  })
})
