import { describe, it, expect } from 'vitest'
import { toolCatalog } from '../../src/tools/catalog.js'

const EXPECTED_ORDER = [
  'get_current_user',
  'get_user',
  'get_guilds',
  'get_guild',
  'get_guild_channels',
  'get_channel',
  'get_guild_member',
  'list_guild_members',
  'search_guild_members',
  'get_guild_roles',
  'get_guild_role_member_counts',
  'get_channel_messages',
  'search_guild_messages',
  'get_channel_message',
  'get_reactions',
  'get_channel_pins',
  'get_poll_answer_voters',
  'list_active_guild_threads',
  'list_public_archived_threads',
  'list_private_archived_threads',
  'list_thread_members',
  'get_guild_audit_log',
  'get_guild_bans',
  'get_guild_invites',
  'list_scheduled_events',
]

describe('toolCatalog', () => {
  it('has exactly the expected tools in registration order', () => {
    expect(toolCatalog.map((t) => t.name)).toEqual(EXPECTED_ORDER)
  })

  it('every tool path() builds a plausible Discord route from its args', () => {
    for (const def of toolCatalog) {
      expect(
        typeof def.path({
          guild_id: '1',
          channel_id: '2',
          user_id: '3',
          message_id: '4',
          answer_id: '5',
          emoji: 'x',
        })
      ).toBe('string')
    }
  })

  describe('get_reactions emoji', () => {
    const getReactions = toolCatalog.find((t) => t.name === 'get_reactions')
    const pathFor = (emoji: string) =>
      getReactions?.path({ channel_id: '2', message_id: '4', emoji })

    it('URL-encodes a raw unicode emoji exactly once', () => {
      expect(pathFor('👍')).toBe(
        '/channels/2/messages/4/reactions/%F0%9F%91%8D'
      )
    })

    it('URL-encodes a raw custom emoji "name:id"', () => {
      expect(pathFor('party:123')).toBe(
        '/channels/2/messages/4/reactions/party%3A123'
      )
    })

    it('documents the input as raw, not URL-encoded', () => {
      expect(getReactions?.inputShape.emoji.description).toContain(
        'not URL-encoded'
      )
    })
  })
})
