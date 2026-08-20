import type { toolCatalog } from './tools/catalog.js'

/**
 * Derives the next-page request parameters from a Discord response body, or
 * `undefined` when there is no next page.
 */
type PaginationCalculator = (
  body: unknown,
  requestParams: Record<string, unknown>
) => Record<string, unknown> | undefined

type ToolName = (typeof toolCatalog)[number]['name']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Reads `.id` off an item, or `undefined` when the item has no string id. */
function idOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined
  const id = item.id
  return typeof id === 'string' ? id : undefined
}

/** Reads `.user.id` off an item, or `undefined` when the item has no such nested id. */
function userIdOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined
  return idOf(item.user)
}

/**
 * Builds a {@link PaginationCalculator} for array responses paged by a
 * Snowflake cursor, choosing `before`/`after` from whichever the caller sent
 * (falling back to the direction that continues past the endpoint's default,
 * cursor-less ordering) and picking the correct edge item for that direction
 * given the endpoint's sort order.
 */
function snowflakeCursor(
  idPath: (item: unknown) => string | undefined,
  defaultLimit: number,
  order: 'ascending' | 'descending'
): PaginationCalculator {
  return (body, params) => {
    const items = Array.isArray(body) ? body : []
    const limit = typeof params.limit === 'number' ? params.limit : defaultLimit
    if (items.length === 0 || items.length < limit) return undefined

    const direction: 'before' | 'after' =
      params.after !== undefined && params.before === undefined
        ? 'after'
        : params.before !== undefined && params.after === undefined
          ? 'before'
          : order === 'ascending'
            ? 'after'
            : 'before'

    const edge =
      (direction === 'before') === (order === 'ascending')
        ? items[0]
        : items.at(-1)
    const id = idPath(edge)
    return id === undefined ? undefined : { [direction]: id }
  }
}

/** Per-tool pagination calculators, keyed by tool name — endpoint-specific, no generic cursor. */
const calculators = {
  get_channel_messages: snowflakeCursor(idOf, 50, 'descending'),
  get_guild_bans: snowflakeCursor(userIdOf, 1000, 'ascending'),
  list_guild_members: snowflakeCursor(userIdOf, 1, 'ascending'),
  get_reactions: snowflakeCursor(idOf, 25, 'ascending'),
  get_guilds: snowflakeCursor(idOf, 200, 'ascending'),
  get_guild_audit_log: (body, params) => {
    if (!isRecord(body)) return undefined
    const entries = Array.isArray(body.audit_log_entries)
      ? body.audit_log_entries
      : []
    const limit = typeof params.limit === 'number' ? params.limit : 50
    if (entries.length === 0 || entries.length < limit) return undefined

    const direction: 'before' | 'after' =
      params.after !== undefined && params.before === undefined
        ? 'after'
        : 'before'
    const edge = direction === 'before' ? entries.at(-1) : entries[0]
    const id = idOf(edge)
    return id === undefined ? undefined : { [direction]: id }
  },
  get_poll_answer_voters: (body, params) => {
    if (!isRecord(body)) return undefined
    const users = Array.isArray(body.users) ? body.users : []
    const limit = typeof params.limit === 'number' ? params.limit : 25
    if (users.length === 0 || users.length < limit) return undefined
    const id = idOf(users.at(-1))
    return id === undefined ? undefined : { after: id }
  },
  list_public_archived_threads: (body) => {
    if (!isRecord(body)) return undefined
    const threads = Array.isArray(body.threads) ? body.threads : []
    const last = threads.at(-1)
    if (!last || !body.has_more || !isRecord(last)) return undefined
    const timestamp = isRecord(last.thread_metadata)
      ? last.thread_metadata.archive_timestamp
      : undefined
    return typeof timestamp === 'string' ? { before: timestamp } : undefined
  },
  list_private_archived_threads: (body) => {
    if (!isRecord(body)) return undefined
    const threads = Array.isArray(body.threads) ? body.threads : []
    const last = threads.at(-1)
    if (!last || !body.has_more || !isRecord(last)) return undefined
    const timestamp = isRecord(last.thread_metadata)
      ? last.thread_metadata.archive_timestamp
      : undefined
    return typeof timestamp === 'string' ? { before: timestamp } : undefined
  },
  get_channel_pins: (body) => {
    if (!isRecord(body)) return undefined
    const items = Array.isArray(body.items) ? body.items : []
    const last = items.at(-1)
    if (!last || !body.has_more || !isRecord(last)) return undefined
    const pinnedAt = last.pinned_at
    return typeof pinnedAt === 'string' ? { before: pinnedAt } : undefined
  },
  list_thread_members: (body, params) => {
    if (!params.with_member) return undefined // v10: only paginated when with_member=true
    const members = Array.isArray(body) ? body : []
    const limit = typeof params.limit === 'number' ? params.limit : 100
    if (members.length === 0 || members.length < limit) return undefined
    const last = members.at(-1)
    if (!isRecord(last)) return undefined
    const userId = typeof last.user_id === 'string' ? last.user_id : undefined
    const id = userId ?? userIdOf(last.member)
    return id === undefined ? undefined : { after: id }
  },
  search_guild_messages: (body, params) => {
    if (!isRecord(body)) return undefined
    const totalResults = body.total_results
    if (typeof totalResults !== 'number') return undefined
    const limit = typeof params.limit === 'number' ? params.limit : 25
    const offset = typeof params.offset === 'number' ? params.offset : 0
    const nextOffset = offset + limit
    const MAX_OFFSET = 9975 // Discord's documented ceiling for this endpoint's offset
    return nextOffset >= totalResults || nextOffset > MAX_OFFSET
      ? undefined
      : { offset: nextOffset }
  },
} satisfies Partial<Record<ToolName, PaginationCalculator>>

/** Widened for lookup by an arbitrary tool name string (see {@link calculators} for the checked literal). */
export const paginationCalculators: Record<
  string,
  PaginationCalculator | undefined
> = calculators
