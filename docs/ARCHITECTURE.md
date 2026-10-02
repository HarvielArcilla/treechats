# Architecture

```
web/index.html          the app: tree model, operations and screens (ported from the claude.ai version)
web/public/local-shim.js loads before the app; connects it to the server:
                          - saving: the app's storage goes to the server instead of the browser
                          - Claude: window.claude.use('sample') sends requests to /api/sample
server/start.ts         entry point: checks the Node version, then starts the server
server/index.ts         HTTP server (Hono): serves the page and the API, localhost only
server/proc.ts          starting and stopping other programs the same way on Windows, macOS and Linux
server/claude.ts        turns → Messages API request; streaming; prompt caching; error codes
server/cli.ts           the same through `claude -p` (Claude Code, e.g. with a subscription)
server/store.ts         SQLite: the app state document and rolling snapshots
server/config.ts        .env settings
```

## API

| Route | What it does |
|---|---|
| `GET /api/config` | Which provider is active and ready, model labels for each tier, limits |
| `GET /api/state`, `PUT /api/state` | Load and save the app state (one JSON document) |
| `GET /api/snapshots`, `GET /api/snapshots/:id` | Earlier saved states |
| `POST /api/sample` | One reply, streamed as newline-separated JSON: `{"t":"text","d"}` pieces, then `{"t":"done",…}` or `{"t":"error","code","message"}`. The page runs up to three at once and queues the rest; a prompt waits for the replies above it, since they are part of what it sends |

## Why the app is still one file

The page is the claude.ai artifact version running unchanged behind a small shim, so everything works locally
from day one. The next phase splits it into modules (see the roadmap); the shim marks exactly the seam between
the app and its environment.
