# Architecture

```
web/index.html          the app: tree model, operations and screens (ported from the claude.ai version)
web/markdown.js         renders replies: Markdown, math (KaTeX), highlighted code
web/public/local-shim.js loads before the app; connects it to the server:
                          - saving: the app's storage goes to the server instead of the browser
                          - Claude: window.claude.use('sample') sends requests to /api/sample
server/start.ts         entry point: checks the Node version, then starts the server
server/index.ts         HTTP server (Hono): serves the page and the API, localhost only
server/proc.ts          starting and stopping other programs the same way on Windows, macOS and Linux
server/claude.ts        turns → Messages API request; streaming; prompt caching; error codes
server/cli.ts           the same through `claude -p` (Claude Code, e.g. with a subscription)
server/mcp.ts           MCP server for Claude Code: read (list, search, get context) and subagents (spawn, ask, fork…)
server/relay.ts         passes subagent commands to the open page and waits for results; request budget per run
server/context.ts       reads the saved tree on the server; builds context the same way the page does
server/store.ts         SQLite in the app data folder: the state document, rolling snapshots, the token, the lock record
server/vault.ts         The password lock: scrypt-wrapped data key, AES-256-GCM, recovery key, auto-lock
server/secrets.ts       The API key in the system keychain (macOS Keychain, Windows DPAPI, libsecret)
server/redact.ts        Hides secrets in command output and diffs
server/config.ts        .env settings
```

## API

Every route below needs the token (a cookie from the sign-in link, or `Authorization: Bearer <token>`), except
`GET /api/auth`, `POST /api/auth/login` and `POST /api/vault/unlock`. With the password lock on and locked, `/api/*`
answers 423 and MCP tools answer "Treechats is locked".

| Route | What it does |
|---|---|
| `GET /api/auth` | Whether this browser is signed in, and whether the lock is on and unlocked |
| `POST /api/auth/login` | `{token}`: signs a browser in with the token (sets the cookie) |
| `POST /api/vault/unlock` | `{password}`, or `{recovery, newPassword}`: unlocks, and signs the browser in |
| `POST /api/vault/enable`, `/disable`, `/password`, `/recovery`, `/settings`, `/lock`, `/alive` | Turn the lock on (returns the recovery key) or off, change the password, make a new recovery key, set the auto-lock, lock now, and count as activity |
| `GET /api/vault/fileskey` | While unlocked, the key the page encrypts attachments with |
| `POST /api/key/save`, `/move`, `/remove` | The API key in the system keychain |
| `POST /api/auth/reset` | A new token; other browsers and coding tools are signed out |

Requests that change something (`POST`/`PUT` under `/api/`) must be sent as `application/json`, which a page on
another site can't do without a CORS preflight that Treechats doesn't answer.
| `GET /api/config` | Which provider is active and ready, model labels for each tier, limits |
| `GET /api/state`, `PUT /api/state` | Load and save the app state (one JSON document) |
| `GET /api/snapshots`, `GET /api/snapshots/:id` | Earlier saved states |
| `POST /mcp` | MCP (streamable HTTP, stateless). Read: `list_projects`, `list_chats`, `get_context`, `search`, `get_prompt`, `get_tree`, `list_saved_prompts`, and `btw` (a side question with a chat's context, answered by the server, changing nothing). Subagents: `spawn`, `ask`, `fork`, `edit_prompt`, `regenerate`, `leave_out`, `edit_reply`, `replay`, `loop`, `fan_out`, `review`, `judge`, `combine`, `distill`, plus `operate` (every other operation by name) and `describe`. `get_prompt` reports when the context above a reply has changed since it was written |
| `GET /api/agent/events` | Server-sent events: subagent commands for the open page to carry out |
| `POST /api/agent/result` | The page's answer to a command: `{id, ok, result}` or `{id, ok:false, error}` |
| `POST /api/sample` | One reply, streamed as newline-separated JSON: `{"t":"text","d"}` pieces, then `{"t":"done",…}` or `{"t":"error","code","message"}`. The page runs up to three at once and queues the rest; a prompt waits for the replies above it, since they are part of what it sends |
| `POST /api/folder/list`, `/read`, `/write` | Folders (server/folders.ts): list files (git-aware), read them, write one back. Paths stay inside the folder; writes only go to folders linked to a project, never into `.git`, and refuse a disk copy that changed since it was read |
| `POST /api/folder/git`, `/diff` | Branch, changed files and diffs for a linked folder (server/run.ts), with secrets hidden |
| `POST /api/folder/run` | Runs a command in a linked folder; refused unless Settings › System allows it and the folder is linked, both checked against the saved state. Secrets in the output are hidden |
| `POST /api/sessions/list`, `/read`, `/parse` | Claude Code and Codex session logs as chats (server/sessions.ts), read-only |

## Why the app is still one file

The page is the claude.ai artifact version running unchanged behind a small shim, so everything works locally
from day one. The next phase splits it into modules (see the roadmap); the shim marks exactly the seam between
the app and its environment.
