import { describe, it, expect } from 'vitest'
import { paginationCalculators } from '../src/pagination.js'

function requireCalc(name: string) {
  const calc = paginationCalculators[name]
  if (!calc) throw new Error(`no pagination calculator registered for ${name}`)
  return calc
}

describe('paginationCalculators', () => {
  it('get_channel_messages: returns { before: oldestId } when a full page of results comes back', () => {
    const calc = requireCalc('get_channel_messages')
    const body = [{ id: '300' }, { id: '200' }, { id: '100' }]
    expect(calc(body, { limit: 3 })).toEqual({ before: '100' })
  })

  it('get_channel_messages: returns undefined when fewer results than limit', () => {
    const calc = requireCalc('get_channel_messages')
    const body = [{ id: '300' }]
    expect(calc(body, { limit: 3 })).toBeUndefined()
  })

  it('list_guild_members: returns { after: lastId } on a full page', () => {
    const calc = requireCalc('list_guild_members')
    const body = [{ user: { id: '1' } }, { user: { id: '2' } }]
    expect(calc(body, { limit: 2 })).toEqual({ after: '2' })
  })

  it("get_channel_pins: uses has_more + last item's pinned_at", () => {
    const calc = requireCalc('get_channel_pins')
    const body = {
      items: [
        { pinned_at: '2026-08-01T00:00:00Z' },
        { pinned_at: '2026-07-01T00:00:00Z' },
      ],
      has_more: true,
    }
    expect(calc(body, { limit: 2 })).toEqual({ before: '2026-07-01T00:00:00Z' })
  })

  it('get_channel_pins: returns undefined when has_more is false', () => {
    const calc = requireCalc('get_channel_pins')
    const body = {
      items: [{ pinned_at: '2026-08-01T00:00:00Z' }],
      has_more: false,
    }
    expect(calc(body, { limit: 2 })).toBeUndefined()
  })

  it('tools with no pagination adapter registered are simply absent from the map', () => {
    expect(paginationCalculators.get_current_user).toBeUndefined()
  })

  it('get_guilds: returns { after: lastId } on a full page', () => {
    const calc = requireCalc('get_guilds')
    const body = [{ id: '10' }, { id: '20' }]
    expect(calc(body, { limit: 2 })).toEqual({ after: '20' })
  })

  it('search_guild_messages: returns { offset: offset + returned } while more results remain', () => {
    const calc = requireCalc('search_guild_messages')
    const body = { messages: [[{ id: '1' }], [{ id: '2' }]], total_results: 5 }
    expect(calc(body, { offset: 0 })).toEqual({ offset: 2 })
  })

  it('search_guild_messages: returns undefined once offset + returned reaches total_results', () => {
    const calc = requireCalc('search_guild_messages')
    const body = { messages: [[{ id: '5' }]], total_results: 5 }
    expect(calc(body, { offset: 4 })).toBeUndefined()
  })
})
