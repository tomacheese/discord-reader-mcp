# discord-reader-mcp

Discord REST API の読み取り機能を Model Context Protocol (MCP) Tool として公開する、read-only な MCP サーバー。Azure Functions (v4, Node.js) 上で動作する。

Discord API を独自の高レベルモデルへ変換せず、レスポンスの構造をほぼそのまま返す thin adapter として実装している。LLM に渡すトークン量を呼び出し側で制御できるよう、全 Tool に共通で [JMESPath](https://jmespath.org/) projection を適用できる。

## 提供する Tool

`src/tools/catalog.ts` に定義された 25 個の read-only Tool を提供する。

| カテゴリ | Tool                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| User     | `get_current_user`, `get_user`                                                                                                             |
| Guild    | `get_guilds`, `get_guild`, `get_guild_roles`, `get_guild_role_member_counts`, `get_guild_audit_log`, `get_guild_bans`, `get_guild_invites` |
| Channel  | `get_guild_channels`, `get_channel`, `get_channel_pins`                                                                                    |
| Member   | `get_guild_member`, `list_guild_members`, `search_guild_members`                                                                           |
| Message  | `get_channel_messages`, `search_guild_messages`, `get_channel_message`, `get_reactions`, `get_poll_answer_voters`                          |
| Thread   | `list_active_guild_threads`, `list_public_archived_threads`, `list_private_archived_threads`, `list_thread_members`                        |
| Event    | `list_scheduled_events`                                                                                                                    |

書き込み系の Tool（メッセージ送信、ロール付与など）は提供しない。

## セットアップ

### 必要環境

- Node.js（バージョンは `.node-version` 参照）
- pnpm（`preinstall` で `only-allow pnpm` を強制）
- Azure Functions Core Tools（ローカル実行用）

```bash
pnpm install
```

### 環境変数

ローカル実行時は `local.settings.json`（`.gitignore` 対象、リポジトリには含まれない）の `Values` に設定する。

| 変数名                       | 必須 | 説明                                                   |
| ---------------------------- | ---- | ------------------------------------------------------ |
| `DISCORD_TOKEN`              | ✅   | Discord Bot Token                                      |
| `MCP_ALLOWED_ORIGINS`        | -    | `/mcp` の CORS 許可オリジン（カンマ区切り）            |
| `DISCORD_REQUEST_TIMEOUT_MS` | -    | Discord API リクエストのタイムアウト（ms、既定 30000） |
| `LOG_LEVEL`                  | -    | ログレベル                                             |

### 開発コマンド

```bash
pnpm build   # tsc ビルド
pnpm watch   # ビルドの watch
pnpm start   # ビルドしてローカルの Azure Functions ホストを起動
pnpm test    # vitest
pnpm lint    # eslint
pnpm format  # prettier --write
```

## デプロイ

Azure Functions (Flex Consumption) へのインフラ構築・デプロイ手順は [`infra/README.md`](./infra/README.md) を参照。`/mcp` エンドポイントは Function App の host key で認証する。

## License

[MIT](./LICENSE)
