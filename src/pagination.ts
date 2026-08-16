/**
 * Derives the next-page request parameters from a Discord response body, or
 * `undefined` when there is no next page.
 */
type PaginationCalculator = (
  body: unknown,
  requestParams: Record<string, unknown>
) => Record<string, unknown> | undefined

/** Builds a {@link PaginationCalculator} for array responses paged by a Snowflake cursor. */
function snowflakeCursor(
  idPath: (item: unknown) => string,
  cursorKey: 'before' | 'after',
  pickEdge: (items: unknown[]) => unknown
): PaginationCalculator {
  return (body, params) => {
    const items = Array.isArray(body) ? body : []
    const limit = typeof params.limit === 'number' ? params.limit : items.length
    if (items.length === 0 || items.length < limit) return undefined
    return { [cursorKey]: idPath(pickEdge(items)) }
  }
}

/** Per-tool pagination calculators, keyed by tool name (spec §11 — endpoint-specific, no generic cursor). */
export const paginationCalculators: Record<string, PaginationCalculator> = {
  get_channel_messages: snowflakeCursor(
    (i) => (i as { id: string }).id,
    'before',
    (items) => items.at(-1)
  ),
  get_guild_bans: snowflakeCursor(
    (i) => (i as { user: { id: string } }).user.id,
    'after',
    (items) => items.at(-1)
  ),
  get_guild_audit_log: snowflakeCursor(
    (i) => (i as { id: string }).id,
    'before',
    (items) => items.at(-1)
  ),
  list_guild_members: snowflakeCursor(
    (i) => (i as { user: { id: string } }).user.id,
    'after',
    (items) => items.at(-1)
  ),
  get_reactions: snowflakeCursor(
    (i) => (i as { id: string }).id,
    'after',
    (items) => items.at(-1)
  ),
  get_poll_answer_voters: (body, params) => {
    const users = (body as { users?: { id: string }[] }).users ?? []
    const limit = typeof params.limit === 'number' ? params.limit : users.length
    const lastUser = users.at(-1)
    if (!lastUser || users.length < limit) return undefined
    return { after: lastUser.id }
  },
  list_public_archived_threads: (body) => {
    const b = body as {
      has_more?: boolean
      threads?: { thread_metadata?: { archive_timestamp?: string } }[]
    }
    const last = b.threads?.at(-1)
    if (!last || !b.has_more) return undefined
    return last.thread_metadata?.archive_timestamp
      ? { before: last.thread_metadata.archive_timestamp }
      : undefined
  },
  list_private_archived_threads: (body) => {
    const b = body as {
      has_more?: boolean
      threads?: { thread_metadata?: { archive_timestamp?: string } }[]
    }
    const last = b.threads?.at(-1)
    if (!last || !b.has_more) return undefined
    return last.thread_metadata?.archive_timestamp
      ? { before: last.thread_metadata.archive_timestamp }
      : undefined
  },
  get_channel_pins: (body) => {
    const b = body as {
      has_more?: boolean
      items?: { pinned_at?: string }[]
    }
    const last = b.items?.at(-1)
    if (!last || !b.has_more) return undefined
    return last.pinned_at ? { before: last.pinned_at } : undefined
  },
  list_thread_members: (body, params) => {
    if (!params.with_member) return undefined // v10: only paginated when with_member=true (spec §17.8)
    const members = Array.isArray(body) ? body : []
    const limit =
      typeof params.limit === 'number' ? params.limit : members.length
    if (members.length === 0 || members.length < limit) return undefined
    const last = members.at(-1) as {
      user_id?: string
      member?: { user?: { id?: string } }
    }
    const id = last.user_id ?? last.member?.user?.id
    return id ? { after: id } : undefined
  },
  get_guilds: snowflakeCursor(
    (i) => (i as { id: string }).id,
    'after',
    (items) => items.at(-1)
  ),
  search_guild_messages: (body, params) => {
    // spec §17.6: do not terminate solely on returned-array length — use total_results.
    const b = body as { messages?: unknown[][]; total_results?: number }
    const offset = typeof params.offset === 'number' ? params.offset : 0
    const returned = b.messages?.length ?? 0
    if (
      typeof b.total_results !== 'number' ||
      offset + returned >= b.total_results
    )
      return undefined
    return { offset: offset + returned }
  },
}
