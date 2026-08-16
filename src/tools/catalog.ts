import { z } from "zod";

const snowflake = z.string().regex(/^\d{1,20}$/, "must be a Discord Snowflake string");
const snowflakeArray = z.array(snowflake);

export interface ToolDef {
  name: string;
  description: string;
  inputShape: import("zod").ZodRawShape;
  path: (args: Record<string, unknown>) => string;
  query?: (args: Record<string, unknown>) => Record<string, unknown>;
  validate?: (args: Record<string, unknown>) => string | undefined;
}

const qs = (args: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
};

export const toolCatalog: ToolDef[] = [
  {
    name: "get_current_user",
    description: "Get the current (bot) user. Discord: Get Current User.",
    inputShape: {},
    path: () => "/users/@me",
  },
  {
    name: "get_user",
    description: "Get a user by ID. Discord: Get User.",
    inputShape: { user_id: snowflake },
    path: (a) => `/users/${a.user_id}`,
  },
  {
    name: "get_guilds",
    description: "List guilds the current user is in. Discord: Get Current User Guilds.",
    inputShape: {
      before: snowflake.optional(),
      after: snowflake.optional(),
      limit: z.number().int().min(1).max(200).optional(),
      with_counts: z.boolean().optional(),
    },
    path: () => "/users/@me/guilds",
    query: (a) => qs(a, ["before", "after", "limit", "with_counts"]),
  },
  {
    name: "get_guild",
    description: "Get a guild by ID. Discord: Get Guild.",
    inputShape: { guild_id: snowflake, with_counts: z.boolean().optional() },
    path: (a) => `/guilds/${a.guild_id}`,
    query: (a) => qs(a, ["with_counts"]),
  },
  {
    name: "get_guild_channels",
    description: "List a guild's channels. Discord: Get Guild Channels.",
    inputShape: { guild_id: snowflake },
    path: (a) => `/guilds/${a.guild_id}/channels`,
  },
  {
    name: "get_channel",
    description: "Get a channel (or thread) by ID. Discord: Get Channel.",
    inputShape: { channel_id: snowflake },
    path: (a) => `/channels/${a.channel_id}`,
  },
  {
    name: "get_guild_member",
    description: "Get a guild member. Discord: Get Guild Member.",
    inputShape: { guild_id: snowflake, user_id: snowflake },
    path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
  },
  {
    name: "list_guild_members",
    description: "List guild members (requires GUILD_MEMBERS intent). Discord: List Guild Members.",
    inputShape: { guild_id: snowflake, limit: z.number().int().min(1).max(1000).optional(), after: snowflake.optional() },
    path: (a) => `/guilds/${a.guild_id}/members`,
    query: (a) => qs(a, ["limit", "after"]),
  },
  {
    name: "search_guild_members",
    description: "Search guild members by name/nickname prefix. Discord: Search Guild Members.",
    inputShape: { guild_id: snowflake, query: z.string().min(1), limit: z.number().int().min(1).max(1000).optional() },
    path: (a) => `/guilds/${a.guild_id}/members/search`,
    query: (a) => qs(a, ["query", "limit"]),
  },
  {
    name: "get_guild_roles",
    description: "List a guild's roles. Discord: Get Guild Roles.",
    inputShape: { guild_id: snowflake },
    path: (a) => `/guilds/${a.guild_id}/roles`,
  },
  {
    name: "get_guild_role_member_counts",
    description: "Get member counts per role. Discord: Get Guild Role Member Counts.",
    inputShape: { guild_id: snowflake },
    path: (a) => `/guilds/${a.guild_id}/roles/member-counts`,
  },
  {
    name: "get_channel_messages",
    description: "List messages in a channel. Discord: Get Channel Messages.",
    inputShape: {
      channel_id: snowflake,
      around: snowflake.optional(),
      before: snowflake.optional(),
      after: snowflake.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    // spec §9.4: around/before/after are mutually exclusive — enforced here since a
    // ZodRawShape has no top-level .refine() to express cross-field constraints.
    validate: (a) => {
      const set = ["around", "before", "after"].filter((k) => a[k] !== undefined);
      return set.length > 1 ? `at most one of around, before, after may be set (got: ${set.join(", ")})` : undefined;
    },
    path: (a) => `/channels/${a.channel_id}/messages`,
    query: (a) => qs(a, ["around", "before", "after", "limit"]),
  },
  {
    name: "search_guild_messages",
    description: "Search messages in a guild. Discord: Search Guild Messages.",
    inputShape: {
      guild_id: snowflake,
      limit: z.number().int().min(1).max(25).optional(),
      offset: z.number().int().min(0).optional(),
      max_id: snowflake.optional(),
      min_id: snowflake.optional(),
      content: z.string().optional(),
      channel_id: snowflakeArray.optional(),
      author_id: snowflakeArray.optional(),
      mentions: snowflakeArray.optional(),
      pinned: z.boolean().optional(),
      has: z.array(z.enum(["link", "embed", "file", "video", "image", "sound", "sticker"])).optional(),
      sort_by: z.enum(["timestamp", "relevance"]).optional(),
      sort_order: z.enum(["asc", "desc"]).optional(),
    },
    path: (a) => `/guilds/${a.guild_id}/messages/search`,
    query: (a) =>
      qs(a, ["limit", "offset", "max_id", "min_id", "content", "channel_id", "author_id", "mentions", "pinned", "has", "sort_by", "sort_order"]),
  },
  {
    name: "get_channel_message",
    description: "Get a single message. Discord: Get Channel Message.",
    inputShape: { channel_id: snowflake, message_id: snowflake },
    path: (a) => `/channels/${a.channel_id}/messages/${a.message_id}`,
  },
  {
    name: "get_reactions",
    description: "List users who reacted with an emoji. Discord: Get Reactions.",
    inputShape: {
      channel_id: snowflake,
      message_id: snowflake,
      emoji: z.string().min(1),
      type: z.number().int().min(0).max(1).optional(),
      after: snowflake.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    path: (a) => `/channels/${a.channel_id}/messages/${a.message_id}/reactions/${encodeURIComponent(String(a.emoji))}`,
    query: (a) => qs(a, ["type", "after", "limit"]),
  },
  {
    name: "get_channel_pins",
    description: "List pinned messages in a channel (current, non-deprecated endpoint). Discord: Get Channel Pins.",
    inputShape: { channel_id: snowflake, before: z.string().datetime().optional(), limit: z.number().int().min(1).max(50).optional() },
    path: (a) => `/channels/${a.channel_id}/messages/pins`,
    query: (a) => qs(a, ["before", "limit"]),
  },
  {
    name: "get_poll_answer_voters",
    description: "List voters for a poll answer. Discord: Get Answer Voters.",
    inputShape: {
      channel_id: snowflake,
      message_id: snowflake,
      answer_id: z.number().int(),
      after: snowflake.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    path: (a) => `/channels/${a.channel_id}/polls/${a.message_id}/answers/${a.answer_id}`,
    query: (a) => qs(a, ["after", "limit"]),
  },
  {
    name: "list_active_guild_threads",
    description: "List active threads in a guild. Discord: List Active Guild Threads.",
    inputShape: { guild_id: snowflake },
    path: (a) => `/guilds/${a.guild_id}/threads/active`,
  },
  {
    name: "list_public_archived_threads",
    description: "List public archived threads in a channel. Discord: List Public Archived Threads.",
    inputShape: { channel_id: snowflake, before: z.string().datetime().optional(), limit: z.number().int().min(1).optional() },
    path: (a) => `/channels/${a.channel_id}/threads/archived/public`,
    query: (a) => qs(a, ["before", "limit"]),
  },
  {
    name: "list_private_archived_threads",
    description: "List private archived threads in a channel (requires READ_MESSAGE_HISTORY + MANAGE_THREADS). Discord: List Private Archived Threads.",
    inputShape: { channel_id: snowflake, before: z.string().datetime().optional(), limit: z.number().int().optional() },
    path: (a) => `/channels/${a.channel_id}/threads/archived/private`,
    query: (a) => qs(a, ["before", "limit"]),
  },
  {
    name: "list_thread_members",
    description: "List members of a thread. Discord: List Thread Members.",
    inputShape: {
      channel_id: snowflake,
      with_member: z.boolean().optional(),
      after: snowflake.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    path: (a) => `/channels/${a.channel_id}/thread-members`,
    query: (a) => qs(a, ["with_member", "after", "limit"]),
  },
  {
    name: "get_guild_audit_log",
    description: "Get a guild's audit log (requires VIEW_AUDIT_LOG). Discord: Get Guild Audit Log.",
    inputShape: {
      guild_id: snowflake,
      user_id: snowflake.optional(),
      action_type: z.number().int().optional(),
      before: snowflake.optional(),
      after: snowflake.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    path: (a) => `/guilds/${a.guild_id}/audit-logs`,
    query: (a) => qs(a, ["user_id", "action_type", "before", "after", "limit"]),
  },
  {
    name: "get_guild_bans",
    description: "List guild bans (requires BAN_MEMBERS). Discord: Get Guild Bans.",
    inputShape: { guild_id: snowflake, before: snowflake.optional(), after: snowflake.optional(), limit: z.number().int().min(1).max(1000).optional() },
    path: (a) => `/guilds/${a.guild_id}/bans`,
    query: (a) => qs(a, ["before", "after", "limit"]),
  },
  {
    name: "get_guild_invites",
    description: "List a guild's invites (requires MANAGE_GUILD or VIEW_AUDIT_LOG). Discord: Get Guild Invites.",
    inputShape: { guild_id: snowflake },
    path: (a) => `/guilds/${a.guild_id}/invites`,
  },
  {
    name: "list_scheduled_events",
    description: "List a guild's scheduled events. Discord: List Scheduled Events for Guild.",
    inputShape: { guild_id: snowflake, with_user_count: z.boolean().optional() },
    path: (a) => `/guilds/${a.guild_id}/scheduled-events`,
    query: (a) => qs(a, ["with_user_count"]),
  },
];
