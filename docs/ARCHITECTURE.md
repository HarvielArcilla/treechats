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
server/store.ts         SQLite: the app state document and rolling snapshots
server/config.ts        .env settings
```

## API

| Route | What it does |
|---|---|
| `GET /api/config` | Which provider is active and ready, model labels for each tier, limits |
| `GET /api/state`, `PUT /api/state` | Load and save the app state (one JSON document) |
| `GET /api/snapshots`, `GET /api/snapshots/:id` | Earlier saved states |
| `POST /mcp` | MCP (streamable HTTP, stateless). Read: `list_projects`, `list_chats`, `get_context`, `search`, `get_prompt`. Subagents: `spawn`, `ask`, `fork`, `leave_out`, `edit_reply`, `regenerate`, `replay`, `review`, `judge`, `combine`, `distill`, `list_saved_prompts`. `get_prompt` reports when the context above a reply has changed since it was written |
| `GET /api/agent/events` | Server-sent events: subagent commands for the open page to carry out |
| `POST /api/agent/result` | The page's answer to a command: `{id, ok, result}` or `{id, ok:false, error}` |
| `POST /api/sample` | One reply, streamed as newline-separated JSON: `{"t":"text","d"}` pieces, then `{"t":"done",…}` or `{"t":"error","code","message"}`. The page runs up to three at once and queues the rest; a prompt waits for the replies above it, since they are part of what it sends |

## Why the app is still one file

The page is the claude.ai artifact version running unchanged behind a small shim, so everything works locally
from day one. The next phase splits it into modules (see the roadmap); the shim marks exactly the seam between
the app and its environment.
