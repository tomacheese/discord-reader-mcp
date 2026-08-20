import { describe, it, expect } from 'vitest'
import { paginationCalculators } from '../src/pagination.js'

function requireCalc(name: string) {
  const calc = paginationCalculators[name]
  if (!calc) throw new Error(`no pagination calculator registered for ${name}`)
  return calc
}

describe('paginationCalculators', () => {
  describe('get_channel_messages (descending order)', () => {
    const calc = requireCalc('get_channel_messages')

    it('defaults to { before: oldestId } when no cursor param is given', () => {
      const body = [{ id: '300' }, { id: '200' }, { id: '100' }]
      expect(calc(body, { limit: 3 })).toEqual({ before: '100' })
    })

    it('continues with { after: newestId } when the caller sent after', () => {
      const body = [{ id: '300' }, { id: '200' }, { id: '100' }]
      expect(calc(body, { after: '50', limit: 3 })).toEqual({ after: '300' })
    })

    it('returns undefined when fewer results than limit', () => {
      const body = [{ id: '300' }]
      expect(calc(body, { limit: 3 })).toBeUndefined()
    })

    it('falls back to the default limit when the caller omits limit', () => {
      const body = Array.from({ length: 49 }, (_, i) => ({ id: String(i) }))
      expect(calc(body, {})).toBeUndefined()
    })

    it('returns undefined when the edge item has no string id', () => {
      const body = [{ id: '300' }, {}]
      expect(calc(body, { limit: 2 })).toBeUndefined()
    })
  })

  describe('get_guild_bans (ascending order)', () => {
    const calc = requireCalc('get_guild_bans')

    it('continues with { before: oldestUserId } when the caller sent before', () => {
      const body = [{ user: { id: '10' } }, { user: { id: '20' } }]
      expect(calc(body, { before: '30', limit: 2 })).toEqual({ before: '10' })
    })

    it('continues with { after: newestUserId } when the caller sent after', () => {
      const body = [{ user: { id: '10' } }, { user: { id: '20' } }]
      expect(calc(body, { after: '5', limit: 2 })).toEqual({ after: '20' })
    })
  })

  describe('list_guild_members', () => {
    it('returns { after: lastId } on a full page', () => {
      const calc = requireCalc('list_guild_members')
      const body = [{ user: { id: '1' } }, { user: { id: '2' } }]
      expect(calc(body, { limit: 2 })).toEqual({ after: '2' })
    })
  })

  describe('get_guild_audit_log', () => {
    const calc = requireCalc('get_guild_audit_log')

    it('reads audit_log_entries off the object body', () => {
      const body = {
        audit_log_entries: [{ id: '300' }, { id: '200' }, { id: '100' }],
        users: [],
      }
      expect(calc(body, { limit: 3 })).toEqual({ before: '100' })
    })

    it('returns undefined when the body is not an object', () => {
      expect(calc(null, { limit: 3 })).toBeUndefined()
    })

    it('returns undefined when fewer entries than limit', () => {
      const body = { audit_log_entries: [{ id: '300' }] }
      expect(calc(body, { limit: 3 })).toBeUndefined()
    })
  })

  describe('get_channel_pins', () => {
    const calc = requireCalc('get_channel_pins')

    it("uses has_more + last item's pinned_at", () => {
      const body = {
        items: [
          { pinned_at: '2026-08-01T00:00:00Z' },
          { pinned_at: '2026-07-01T00:00:00Z' },
        ],
        has_more: true,
      }
      expect(calc(body, { limit: 2 })).toEqual({
        before: '2026-07-01T00:00:00Z',
      })
    })

    it('returns undefined when has_more is false', () => {
      const body = {
        items: [{ pinned_at: '2026-08-01T00:00:00Z' }],
        has_more: false,
      }
      expect(calc(body, { limit: 2 })).toBeUndefined()
    })

    it('returns undefined when the body is not an object', () => {
      expect(calc(null, {})).toBeUndefined()
    })
  })

  describe('get_poll_answer_voters', () => {
    const calc = requireCalc('get_poll_answer_voters')

    it('returns { after: lastUserId } on a full page', () => {
      const body = { users: [{ id: '1' }, { id: '2' }] }
      expect(calc(body, { limit: 2 })).toEqual({ after: '2' })
    })

    it('returns undefined when the body is not an object', () => {
      expect(calc(undefined, {})).toBeUndefined()
    })
  })

  describe('list_public_archived_threads / list_private_archived_threads', () => {
    it.each(['list_public_archived_threads', 'list_private_archived_threads'])(
      '%s: returns undefined when the body is not an object',
      (name) => {
        expect(requireCalc(name)(null, {})).toBeUndefined()
      }
    )
  })

  describe('tools with no pagination adapter registered', () => {
    it('are simply absent from the map', () => {
      expect(paginationCalculators.get_current_user).toBeUndefined()
    })
  })

  describe('get_guilds', () => {
    it('returns { after: lastId } on a full page', () => {
      const calc = requireCalc('get_guilds')
      const body = [{ id: '10' }, { id: '20' }]
      expect(calc(body, { limit: 2 })).toEqual({ after: '20' })
    })
  })

  describe('search_guild_messages', () => {
    const calc = requireCalc('search_guild_messages')

    it('advances by limit (not by the returned array length) while more results remain', () => {
      const body = { messages: [[{ id: '1' }]], total_results: 100 }
      expect(calc(body, { offset: 0, limit: 25 })).toEqual({ offset: 25 })
    })

    it('returns undefined once offset + limit reaches total_results', () => {
      const body = { messages: [], total_results: 30 }
      expect(calc(body, { offset: 10, limit: 20 })).toBeUndefined()
    })

    it("returns undefined once offset + limit exceeds Discord's 9975 max offset", () => {
      const body = { total_results: 1_000_000 }
      expect(calc(body, { offset: 9960, limit: 25 })).toBeUndefined()
    })

    it('returns undefined when the body is not an object', () => {
      expect(calc(null, { offset: 0 })).toBeUndefined()
    })

    it('returns undefined when total_results is missing', () => {
      expect(calc({}, { offset: 0 })).toBeUndefined()
    })
  })
})
