# Discord REST MCP 基本設計書

- 文書種別: 基本設計書
- 対象: Discord REST API 用 Read-only MCP Server
- 設計日: 2026-08-17 (JST)
- 設計ステータス: v1 基本設計

## 1. 目的

Discord REST API の主要な読み取り機能を Model Context Protocol (MCP) Tool として提供する。

本システムは Discord API を独自の高レベルモデルへ変換するのではなく、**Discord REST API の request / response semantics を極力保持する thin adapter** とする。一方で、LLM へ渡すトークン量を呼び出し側で制御できるよう、全 Tool に JMESPath projection を共通機能として追加する。

設計原則は以下とする。

> Discord REST MCP = lossless thin proxy + JMESPath projection + native pagination metadata

## 2. スコープ

### 2.1 v1 対象

- Discord REST API の read-only endpoint
- 主要 25 Tool
- 複数 Guild 対応
- MCP Streamable HTTP Server
- 単一 Bearer token による MCP authentication
- Discord native pagination
- JMESPath による response projection
- Discord HTTP status / rate-limit headers の metadata 提供
- Azure Functions へのデプロイ

### 2.2 v1 対象外

- Discord への書き込み操作
  - message send/edit/delete
  - role/member moderation
  - channel/guild settings modification
  - webhook execution 等
- Discord Gateway / WebSocket
- Presence / realtime events
- Voice / Stage realtime state
- server-side 自動 pagination
- 複数ページの自動 aggregation
- response の自動 truncate / 要約
- MCP 独自の `maxItems` / `maxBytes`
- Guild allowlist
- OAuth 2.1 authorization flow
- multi-tenant token management
- 汎用 `discord_request` Tool

## 3. 技術スタック

| 区分                       | 採用技術                                       | 方針                                                         |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Language                   | TypeScript                                     | strict mode                                                  |
| Runtime                    | Node.js 24 LTS                                 | `@discordjs/rest` 要件に合わせ 24.17.0 以上                  |
| Package manager            | pnpm                                           | lockfile を commit                                           |
| MCP SDK                    | MCP TypeScript SDK v2                          | `@modelcontextprotocol/server`, `@modelcontextprotocol/node` |
| MCP protocol               | 2026-07-28 primary                             | SDK v2 の stateless legacy compatibility も許容              |
| Discord REST               | `@discordjs/rest`                              | Gateway library は使用しない                                 |
| Discord types/routes       | `discord-api-types/v10`                        | Discord API v10                                              |
| Validation                 | Zod 4                                          | Tool input / environment validation                          |
| Projection                 | JMESPath                                       | 共通入力 `jmespath`                                          |
| JMESPath JS implementation | `@jmespath-community/jmespath`                 | version pin。仕様適合をテストで担保                          |
| Test                       | Vitest                                         | unit / integration                                           |
| Deployment                 | Azure Functions (Node.js v4 programming model) | HTTP trigger、host が process lifecycle を管理               |

依存 package の exact version は lockfile で固定する。基本設計では major/API line を規定し、patch version は実装開始時点の安定版を採用する。

## 4. システム構成

```text
MCP Client
    |
    | HTTPS
    v
Reverse Proxy / Load Balancer / Tunnel
    |
    | HTTP (trusted/private network)
    v
+--------------------------------------+
| Discord REST MCP                     |
|                                      |
|  Auth / Origin Validation            |
|        |                             |
|  MCP Tool Registry                   |
|        |                             |
|  Discord REST Adapter                |
|        |                             |
|  Pagination Adapter                  |
|        |                             |
|  JMESPath Projection                 |
|        |                             |
|  Response Builder                    |
+----------------+---------------------+
                 |
                 | HTTPS
                 v
          Discord REST API v10
```

### 4.1 TLS

アプリケーション自身では TLS termination を行わない。

- Internet 側: HTTPS 必須
- TLS termination: reverse proxy / load balancer / tunnel 側
- MCP application: HTTP listener

デプロイ先、domain、certificate management、reverse proxy 製品は deployment design で決定する。

### 4.2 Stateless

MCP server は stateless とする。

保持しない状態:

- 選択中 Guild
- 前回 Tool の request arguments
- pagination cursor
- search state
- client session state

各 Tool call は単独で完結する。水平 scale 時に sticky session を要求しない。

## 5. HTTP Interface

### 5.1 MCP endpoint

```text
POST /mcp
```

MCP 2026-07-28 Streamable HTTP を primary protocol とする。MCP SDK v2 の stateless legacy compatibility により 2025-era client も追加状態管理なしで扱える範囲では受け入れる。

旧仕様の long-lived `GET /mcp` stream endpoint は提供しない。

### 5.2 Health endpoint

```text
GET /healthz
```

Response:

```json
{
  "status": "ok"
}
```

`/healthz` は Discord API を呼び出さない。process が request を受け付けられることのみを確認する liveness endpoint とする。

## 6. Authentication / Security

### 6.1 MCP authentication

`POST /mcp` に単一 Bearer token を要求する。

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

Token は環境変数で設定する。

```text
MCP_AUTH_TOKEN=<secret>
```

Missing / invalid token は HTTP 401 とする。

v1 では固定 shared secret を使用し、OAuth 2.1 authorization server は実装しない。

### 6.2 Discord authentication

Discord Bot token は別 secret とする。

```text
DISCORD_TOKEN=<bot-token>
```

`MCP_AUTH_TOKEN` と `DISCORD_TOKEN` は用途・lifecycle を完全に分離する。

### 6.3 Origin validation

MCP 2026-07-28 Streamable HTTP の要件に従い、`Origin` header が存在する request は必ず検証する。

```text
MCP_ALLOWED_ORIGINS=https://example-client.invalid,...
```

方針:

- `Origin` がない request: Bearer authentication を通過すれば許可
- `Origin` がある request: allowlist と一致する場合のみ許可
- allowlist 未設定かつ `Origin` がある request: deny
- invalid Origin: HTTP 403

実際の許可 Origin は deployment design 時に決定する。

### 6.4 Secret handling

以下を禁止する。

- token の application log 出力
- exception message への token 混入
- startup config dump への secret 出力
- Discord request Authorization header の log 出力

Process 実行環境（ユーザー権限、隔離）は Azure Functions host が管理する。

## 7. Configuration

### 7.1 Environment variables

| Name                         | Required | Default | Description                      |
| ---------------------------- | -------: | ------- | -------------------------------- |
| `DISCORD_TOKEN`              |      Yes | -       | Discord Bot token                |
| `MCP_AUTH_TOKEN`             |      Yes | -       | MCP inbound Bearer token         |
| `MCP_ALLOWED_ORIGINS`        |       No | empty   | comma-separated Origin allowlist |
| `DISCORD_REQUEST_TIMEOUT_MS` |       No | `30000` | Discord REST request timeout     |
| `LOG_LEVEL`                  |       No | `info`  | application log level            |

全設定は startup 時に Zod で validation する。不正な必須設定がある場合は fail-fast で process を終了する。

## 8. Component Design

### 8.1 Config

責務:

- environment variable load
- validation
- normalized immutable configuration の生成

Secret value を stringify 可能な config dump に含めない。

### 8.2 HTTP / MCP Server

責務:

- `/mcp` の MCP protocol handling
- `/healthz`
- Bearer validation
- Origin validation
- request-scoped logging context

MCP SDK v2 の `createMcpHandler` と Node adapter を基本とする。

### 8.3 Tool Registry

責務:

- 25 Tool の登録
- input schema / description の定義
- read-only annotation
- endpoint adapter 呼び出し

Tool list の順序は deterministic とする。

### 8.4 Discord REST Adapter

責務:

- `@discordjs/rest` による Discord API v10 call
- Discord native rate-limit queue
- timeout
- raw response body / HTTP status / selected headers の取得
- Discord error body の保持

MCP 層へ次の論理値を返す。

```ts
interface DiscordHttpResult {
  body: unknown
  status: number
  headers: Record<string, string>
}
```

HTTP metadata を失わないことを必須要件とする。

`@discordjs/rest` の高レベル `get()` 等は body のみを返すため、実装時には `ResponseLike` を concurrency-safe に取得できる public API / hook を使用する。複数 Tool の同時実行時に response metadata が別 request と混線してはならない。

### 8.5 Pagination Adapter

責務:

- raw Discord response と request parameter から次ページ parameter を算出
- `meta.pagination.next` を生成

endpoint ごとに native pagination semantics が異なるため、generic cursor abstraction は作らない。

### 8.6 JMESPath Projector

責務:

- `jmespath` 指定時のみ Discord response body へ projection を適用
- 結果を JSON value として返す
- invalid expression を MCP execution error 化

JMESPath は **response body のみに適用**し、`meta` には適用しない。

### 8.7 Response Builder

責務:

- Discord body / JMESPath result を `data` に格納
- HTTP / pagination metadata を `meta` に格納
- Discord error と MCP-local error を区別

## 9. Tool Common Contract

### 9.1 Input policy

各 Tool は対応 Discord endpoint の parameter 名を極力そのまま公開する。

例:

```json
{
  "guild_id": "123456789012345678",
  "content": "deploy",
  "channel_id": ["111", "222"],
  "author_id": ["333"],
  "limit": 25,
  "offset": 0,
  "jmespath": "messages[].{id:id,content:content}"
}
```

`jmespath` のみ MCP 固有 parameter とする。

Discord の native `query` parameter と衝突するため、JMESPath input の名前に `query` は使用しない。

### 9.2 Snowflake

Discord Snowflake は全て JSON string とする。

```json
"123456789012345678"
```

JavaScript `number` では扱わない。

### 9.3 Default values

Discord API に default がある parameter は、原則として MCP 側で明示補完せず、未指定のまま Discord へ送る。

pagination metadata 算出に endpoint default の認識が必要な場合のみ内部ロジックで利用する。

### 9.4 Validation

Zod schema に以下を反映する。

- required / optional
- integer range
- enum
- Snowflake string
- endpoint 上明確な mutually exclusive parameter

Discord permission や resource state のように server-side でのみ確定する条件は再実装せず Discord に判定させる。

## 10. Tool Response Contract

### 10.1 Normal response

全 Tool の `structuredContent` は次の envelope とする。

```json
{
  "data": {},
  "meta": {
    "http": {
      "status": 200,
      "headers": {}
    },
    "pagination": {
      "next": {}
    }
  }
}
```

### 10.2 `data`

`jmespath` 未指定:

```text
data = Discord response body
```

`jmespath` 指定:

```text
data = JMESPath(Discord response body)
```

JMESPath result は object に限定しない。

許容:

- object
- array
- string
- number
- boolean
- null

MCP response envelope 自体は object のままなので `structuredContent` は常に `{ data, meta, ... }` 形式を維持する。

### 10.3 `meta.http`

Discord HTTP response を受信した場合は常に保持する。

```json
{
  "status": 200,
  "headers": {
    "x-ratelimit-limit": "5",
    "x-ratelimit-remaining": "4"
  }
}
```

header 名は lowercase に正規化する。

### 10.4 Exposed Discord headers

全 header は返さず、意味のある Discord header を allowlist する。

- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset`
- `x-ratelimit-reset-after`
- `x-ratelimit-bucket`
- `x-ratelimit-global`
- `x-ratelimit-scope`
- `retry-after`

Reverse proxy / Cloudflare 等の transport-specific header は Tool result に含めない。

## 11. Pagination

### 11.1 Principle

server-side 自動 pagination は行わない。

Discord API native parameter をそのまま caller が次回 request に指定する。

MCP は次回 call に必要な parameter の導出だけを補助する。

### 11.2 Metadata

pagination 対応 endpoint のみ以下を返す。

```json
{
  "pagination": {
    "next": {
      "before": "123456789012345678"
    }
  }
}
```

`next` は opaque cursor ではなく、**次回の同一 Tool call に merge できる Discord native request parameter object** とする。

例:

1st call:

```json
{
  "channel_id": "1",
  "limit": 100
}
```

Response metadata:

```json
{
  "pagination": {
    "next": {
      "before": "999"
    }
  }
}
```

2nd call:

```json
{
  "channel_id": "1",
  "limit": 100,
  "before": "999"
}
```

### 11.3 Direction

v1 が生成する共通 metadata は `next` のみとする。

`previous` abstraction は設けない。

### 11.4 Calculation order

```text
Discord response
      |
      +--> HTTP status / headers
      |
      +--> pagination calculation from raw body
      |
      v
JMESPath projection
      |
      v
{ data, meta }
```

JMESPath により ID や pagination-related field が `data` から削除されても、`meta.pagination` は維持する。

## 12. MCP Content Representation

### 12.1 Canonical output

`structuredContent` を正本とする。

```json
{
  "content": [],
  "structuredContent": {
    "data": {},
    "meta": {}
  }
}
```

同一 JSON を `content` の TextContent へ二重格納しない。

MCP 2026-07-28 specification は backward compatibility のため TextContent への JSON serialization を SHOULD としているが、v1 は token duplication を避けるため意図的に `structuredContent` only を採用する。

対象 client が `structuredContent` を正しく model/tool pipeline で利用できることを integration test の release gate とする。

### 12.2 Output schema

共通 envelope の shape は output schema で定義するが、`data` は JMESPath により任意 JSON value になるため strict Discord response schema では拘束しない。

## 13. Error Handling

### 13.1 Discord API errors

Discord から HTTP response が返った場合、Discord error body を独自 error model へ変換しない。

例:

```json
{
  "data": {
    "message": "Missing Permissions",
    "code": 50013
  },
  "meta": {
    "http": {
      "status": 403,
      "headers": {}
    }
  }
}
```

MCP Tool result は `isError: true` とする。

Discord HTTP status と Discord JSON error code の両方を保持する。

Discord error response には JMESPath を適用しない。

### 13.2 Discord 2xx special responses

Discord が 2xx を返した場合、body 内に status-like code が存在しても原則 MCP error としない。

例: Guild Message Search の index 準備中 HTTP 202 response。

caller が `meta.http.status` と `data` を見て次の action を判断する。

### 13.3 MCP-local execution errors

Discord HTTP response が存在しない失敗は MCP-local error とする。

対象:

- invalid JMESPath
- Discord request timeout
- DNS / connection failure
- internal processing failure

形式:

```json
{
  "data": null,
  "meta": {},
  "error": {
    "type": "DISCORD_REQUEST_TIMEOUT",
    "message": "Discord request timed out"
  }
}
```

`isError: true` とする。

Error type は programmatic に安定した identifier とする。stack trace や secret は返さない。

### 13.4 Protocol / input errors

Tool input schema validation failure は MCP SDK の protocol-level invalid params handling に任せる。Discord API は呼び出さない。

## 14. Timeout / Retry / Rate Limit

### 14.1 Timeout

Default:

```text
DISCORD_REQUEST_TIMEOUT_MS=30000
```

各 Discord request に適用する。

### 14.2 Retry

MCP 独自 retry は行わない。

特に `@discordjs/rest` は 5xx / timeout に対する retry default を持つため、**`retries: 0` を明示設定**する。

- 5xx: retry しない
- network error: retry しない
- timeout: retry しない

### 14.3 429 / rate limit

Discord native rate limit handling は `@discordjs/rest` の queue / bucket management を利用する。`REST` 初期化時に `timeout: DISCORD_REQUEST_TIMEOUT_MS` と `retries: 0` を明示設定する。

rate-limit 値を MCP 側で hard-code しない。

最終 Discord response から利用可能な rate-limit header を `meta.http.headers` に載せる。

## 15. Logging / Observability

### 15.1 Log fields

原則以下を structured log として記録する。

- timestamp
- log level
- request correlation id
- MCP Tool name
- Discord route template
- HTTP status
- latency
- rate-limit bucket / remaining 等の非機密 rate-limit metadata
- error class/type

### 15.2 Log に残さないもの

- `MCP_AUTH_TOKEN`
- `DISCORD_TOKEN`
- Authorization header
- message content
- DM body
- Discord raw response body
- JMESPath 適用前 payload
- request parameter 内の message search content 等、会話内容を含み得る値

### 15.3 Debug logging

`LOG_LEVEL=debug` でも secret / raw Discord payload の記録禁止は解除しない。

## 16. Discord Intents / Permissions

### 16.1 Bot configuration prerequisite

v1 は以下の privileged intent を有効化する前提とする。

- `MESSAGE_CONTENT`
- `GUILD_MEMBERS`

Gateway は使用しないが、Discord REST endpoint 側で intent requirement が適用される機能があるため Bot configuration requirement として扱う。

### 16.2 Permission handling

各 Guild / Channel における permission は Discord の判定を正本とする。

MCP 側で permission matrix を複製して事前拒否しない。

403 等は Discord response をそのまま返す。

## 17. v1 Tool Catalog

全 Tool に共通で `jmespath?: string` を追加する。

### 17.1 User / Identity

#### `get_current_user`

Discord: Get Current User

主用途: Bot identity の確認。

Pagination: なし。

#### `get_user`

Discord: Get User

主要入力:

- `user_id`

Pagination: なし。

### 17.2 Guild

#### `get_guilds`

Discord: Get Current User Guilds

主要入力:

- `before?`
- `after?`
- `limit?`
- `with_counts?`

Pagination: `before` / `after` / `limit`。

複数 Guild 対応時の discovery entry point とする。

#### `get_guild`

主要入力:

- `guild_id`
- `with_counts?`

Pagination: なし。

#### `get_guild_channels`

主要入力:

- `guild_id`

Pagination: なし。

### 17.3 Channel

#### `get_channel`

主要入力:

- `channel_id`

Guild channel / thread 等の詳細取得。

Pagination: なし。

### 17.4 Member

#### `get_guild_member`

主要入力:

- `guild_id`
- `user_id`

Pagination: なし。

#### `list_guild_members`

主要入力:

- `guild_id`
- `limit?`
- `after?`

Pagination: `after`。

Requirement: `GUILD_MEMBERS` privileged intent。

#### `search_guild_members`

主要入力:

- `guild_id`
- `query`
- `limit?`

`query` は Discord native member-search query。JMESPath は `jmespath` で指定する。

Pagination: native cursor なし。

### 17.5 Role

#### `get_guild_roles`

主要入力:

- `guild_id`

Pagination: なし。

#### `get_guild_role_member_counts`

主要入力:

- `guild_id`

Pagination: なし。

### 17.6 Message

#### `get_channel_messages`

主要入力:

- `channel_id`
- `around?`
- `before?`
- `after?`
- `limit?`

`around` / `before` / `after` は mutually exclusive。

Pagination: native message Snowflake cursor。

#### `search_guild_messages`

主要入力は Discord Search Guild Messages の native filters を公開する。

代表例:

- `guild_id`
- `limit?`
- `offset?`
- `max_id?`
- `min_id?`
- `content?`
- `channel_id?`
- `author_id?`
- mention / role / attachment / link / pinned / has 等の supported filters
- sort options

Requirements:

- `READ_MESSAGE_HISTORY`
- `MESSAGE_CONTENT` privileged intent の影響を受ける

Pagination: endpoint 固有 adapter を使用する。結果配列長だけで終了判定しない。

#### `get_channel_message`

主要入力:

- `channel_id`
- `message_id`

Pagination: なし。

#### `get_reactions`

主要入力:

- `channel_id`
- `message_id`
- `emoji`
- `type?`
- `after?`
- `limit?`

Pagination: `after` user Snowflake。

#### `get_channel_pins`

現行 Get Channel Pins endpoint を使用し、deprecated Get Pinned Messages は使用しない。

主要入力:

- `channel_id`
- `before?` (ISO8601 timestamp)
- `limit?`

Response の `items` / `has_more` と `pinned_at` から次ページを導出する。

### 17.7 Poll

#### `get_poll_answer_voters`

主要入力:

- `channel_id`
- `message_id`
- `answer_id`
- `after?`
- `limit?`

Pagination: `after` user Snowflake。

### 17.8 Thread

#### `list_active_guild_threads`

主要入力:

- `guild_id`

Pagination: なし。

#### `list_public_archived_threads`

主要入力:

- `channel_id`
- `before?`
- `limit?`

Pagination: archive timestamp。

#### `list_private_archived_threads`

Permission: `READ_MESSAGE_HISTORY` + `MANAGE_THREADS`。

主要入力:

- `channel_id`
- `before?`
- `limit?`

Pagination: archive timestamp。

必要 permission は Discord endpoint semantics に従う。

#### `list_thread_members`

主要入力:

- `channel_id`
- `with_member?`
- `after?`
- `limit?`

Pagination: API v10 では `with_member=true` のとき `after` / `limit` による paginated results を使用する。`with_member` 未指定/false では v10 の非 pagination 挙動をそのまま保持し、`meta.pagination` を捏造しない。`GUILD_MEMBERS` privileged intent の影響を受ける。

### 17.9 Audit / Moderation

#### `get_guild_audit_log`

主要入力:

- `guild_id`
- `user_id?`
- `action_type?`
- `before?`
- `after?`
- `limit?`

Permission: `VIEW_AUDIT_LOG`。

Pagination: audit log entry Snowflake。

#### `get_guild_bans`

主要入力:

- `guild_id`
- `before?`
- `after?`
- `limit?`

Permission: `BAN_MEMBERS`。

Pagination: user Snowflake。

### 17.10 Invite

#### `get_guild_invites`

主要入力:

- `guild_id`

Permission: `MANAGE_GUILD` または `VIEW_AUDIT_LOG`。

Pagination: なし。

### 17.11 Scheduled Event

#### `list_scheduled_events`

主要入力:

- `guild_id`
- `with_user_count?`

Pagination: なし。

## 18. JMESPath Behavior

### 18.1 Examples

Projection:

```text
messages[].{id:id,author:author.username,content:content}
```

Filter:

```text
messages[?author.id == '123'].{id:id,content:content}
```

Slice:

```text
messages[:5].{id:id,content:content}
```

### 18.2 No output limits

MCP application は以下を実装しない。

- JMESPath result hard byte limit
- item count limit
- silent truncate
- automatic sampling

大きな response を避ける責務は caller に置く。

caller は以下を使用する。

1. Discord native `limit` / cursor / offset / filters
2. `jmespath`

## 19. Testing Strategy

### 19.1 Unit tests

対象:

- environment validation
- Bearer validation
- Origin validation
- Snowflake validation
- Tool input schema
- JMESPath success/error
- rate-limit header extraction
- each pagination adapter
- response envelope
- error mapping

### 19.2 Discord REST integration tests with fake transport

`@discordjs/rest` の transport/request boundary を injection し、実ネットワークを使わずに以下を検証する。

- request route
- query parameter encoding
- native Discord parameter names
- status/header preservation
- Discord error preservation
- 429 queue behavior 周辺
- timeout / network error mapping

### 19.3 MCP integration tests

MCP SDK の HTTP handler を in-process で呼び出し、以下を検証する。

- tool listing
- deterministic tool order
- authentication
- Origin rejection
- tools/call
- input validation
- `structuredContent`
- `isError`
- `content: []` 方針

### 19.4 Live Discord integration tests

専用 test Guild / Bot token が存在する場合のみ実行する opt-in suite とする。

必須 CI にはしない。

確認項目:

- `get_current_user`
- `get_guilds`
- message history
- message search
- member search
- pagination continuation
- rate-limit metadata の取得

Write operation は一切テストしない。

### 19.5 ChatGPT / target client acceptance test

Release gate として、対象 MCP client から remote MCP として接続し、以下を確認する。

- Tool discovery
- Bearer authentication
- `structuredContent` が model から利用可能
- `content: []` でも Tool result が欠落しない
- JMESPath による token reduction が機能する
- `meta.pagination.next` を利用して次ページを呼べる
- Discord error body / status を model が確認できる

もし target client が `structuredContent` only を正しく利用できない場合のみ、`content` policy を再検討する。

## 20. Non-functional Requirements

### 20.1 Correctness

- Discord wire semantics を独自 model へ不要に変換しない
- endpoint-specific pagination semantics を保持する
- Snowflake precision loss を発生させない
- response metadata を concurrent request 間で混線させない

### 20.2 Performance

- server-side aggregation は行わない
- JMESPath は response body に対し 1 回だけ評価する
- log serialization で Discord payload 全体を複製しない

### 20.3 Availability

- Discord/network failure を server crash に波及させない
- `/healthz` は Discord outage に依存しない
- Tool failure は request-scoped に返却する

### 20.4 Scalability

- stateless
- horizontally scalable
- shared application state store 不要
- rate-limit state は各 process の `@discordjs/rest` instance 内で管理

複数 replica にした場合、Discord rate-limit coordination は replica 間で共有されない。そのため大規模 horizontal scale が必要になった時点で rate-limit architecture を再評価する。v1 の想定規模では単一または少数 replica を前提とする。

## 21. Deployment Requirements

Runtime: Azure Functions (Node.js, v4 programming model)。

- Node.js 24 LTS (`.node-version` で pin)
- HTTP trigger のみ (`/mcp`, `/healthz`)、`host.json` の `routePrefix` で既定の `/api` prefix を除去
- secrets は `local.settings.json` / Azure Functions の application settings で管理し、image や repository に bake しない
- process lifecycle（起動、シャットダウン、再起動）は Azure Functions host が管理するため application 側で個別に実装しない
- sufficiently long function timeout (Discord request timeout 30 sec より大きいこと)

## 22. v1 Acceptance Criteria

以下を全て満たした時点で v1 実装を受入可能とする。

1. 25 Tool が MCP `tools/list` で安定した順序で公開される。
2. 全 Tool が read-only であり Discord write endpoint を呼ばない。
3. `get_guilds` から複数 Guild を discovery できる。
4. Discord native parameter 名・型・主要制約が Tool schema に反映される。
5. 全 Tool で `jmespath` が利用できる。
6. JMESPath 未指定時は Discord body が `data` で実質 lossless に取得できる。
7. JMESPath 指定時も pagination metadata が失われない。
8. Discord HTTP status と selected semantic headers が `meta.http` で取得できる。
9. pagination endpoint では `meta.pagination.next` から次 request を構成できる。
10. MCP 独自 response size / item limit / truncation が存在しない。
11. Discord 4xx/5xx body が独自 error model に書き換えられない。
12. 5xx / timeout に自動 retry しない (`@discordjs/rest retries: 0`)。
13. Discord rate-limit handling は library queue に従う。
14. `DISCORD_REQUEST_TIMEOUT_MS` default 30000 ms が適用される。
15. Bearer token なしでは `/mcp` を利用できない。
16. invalid Origin は拒否される。
17. secret / message body / raw response body が application log に残らない。
18. `/healthz` は Discord API を呼ばずに応答する。
19. Azure Functions app が `.node-version` で pin された Node.js 24 LTS 上で起動する。
20. target MCP client で `structuredContent` only output を実利用できることが確認される。

## 23. Future Scope Candidates

v1.1 以降の候補:

- `get_guild_role`
- `get_guild_ban`
- individual invite retrieval
- scheduled event detail / users
- Auto Moderation rules
- onboarding / welcome screen
- integrations
- emojis / stickers
- soundboard
- webhooks read APIs
- additional thread endpoints
- additional read-only Discord REST endpoints

Gateway が必要な Presence / realtime / voice state は REST MCP の単純拡張とは分離し、必要になった時点で別 subsystem として設計する。

## 24. Explicit Design Decisions

| Decision                   | v1                                            |
| -------------------------- | --------------------------------------------- |
| Read / Write               | Read-only                                     |
| Discord Gateway            | No                                            |
| Guild scope                | Multiple Guilds                               |
| Tool granularity           | High-level endpoint-specific Tools only       |
| Generic REST escape hatch  | No                                            |
| Projection                 | JMESPath                                      |
| Common projection field    | `jmespath`                                    |
| Response hard size limit   | No                                            |
| Common item limit          | No                                            |
| Automatic truncate         | No                                            |
| Automatic pagination       | No                                            |
| Pagination metadata        | `meta.pagination.next`                        |
| Response envelope          | `{ data, meta }`                              |
| HTTP metadata              | status + allowlisted Discord semantic headers |
| Error mapping              | Discord errors preserved                      |
| Retry                      | 5xx/network/timeout retry なし                |
| Rate limit                 | `@discordjs/rest` queue handling              |
| Discord timeout            | 30 sec default, configurable                  |
| MCP auth                   | Single Bearer token from env                  |
| TLS                        | External termination                          |
| Server state               | Stateless                                     |
| Logging payload            | Prohibited                                    |
| MCP canonical Tool result  | `structuredContent`                           |
| Duplicate JSON TextContent | No (`content: []`)                            |

## 25. References

仕様・実装時の一次参照先:

- MCP Specification 2026-07-28 — Streamable HTTP  
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- MCP Specification 2026-07-28 — Tools / Structured Content  
  https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx
- MCP TypeScript SDK v2  
  https://github.com/modelcontextprotocol/typescript-sdk
- MCP TypeScript SDK — Supporting 2026-07-28  
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- Discord Developer Documentation — Message Resource  
  https://docs.discord.com/developers/resources/message
- Discord Developer Documentation — Guild Resource  
  https://docs.discord.com/developers/resources/guild
- Discord Developer Documentation — Channel Resource  
  https://docs.discord.com/developers/resources/channel
- Discord Developer Documentation — User Resource  
  https://docs.discord.com/developers/resources/user
- Discord Developer Documentation — Audit Logs  
  https://docs.discord.com/developers/resources/audit-log
- Discord Developer Documentation — Rate Limits  
  https://docs.discord.com/developers/topics/rate-limits
- discord.js REST documentation  
  https://discord.js.org/docs/packages/rest/main
- JMESPath JavaScript implementation  
  https://github.com/jmespath/jmespath.js
