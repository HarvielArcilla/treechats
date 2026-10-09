# Architecture

```
web/index.html          the page's markup
web/src/                the page's script, in files by topic, joined in order into /app.js (see web/src/README.md)
web/styles/             the page's styles
scripts/app-script.ts   the Vite plugin that joins web/src into app.js, with a source map
web/markdown.js         renders replies: Markdown, math (KaTeX), highlighted code
web/public/sendmodes.js  Include as rules: what each turn sends in each mode (shared with the server)
web/public/treecore.js  the tree and the context a prompt sends: path, merge notes, model settings, the request,
                          Copy as a prompt, the context fingerprint. Shared: the page loads it as a script, the
                          server imports it, so both build exactly the same request
web/public/docsync.js   how the document splits into units (a prompt, a branch, a setting) and how changes apply;
                          shared, so the page and the server merge changes the same way
web/public/treeops.js   tree helpers and the ✦ tools (replay, judge, combine, review, loop checks, fan out),
                          used by the page for you and by the server for agents
web/public/local-shim.js loads before the app; connects it to the server:
                          - saving: the app's storage goes to the server instead of the browser
                          - Claude: window.claude.use('sample') sends requests to /api/sample
server/start.ts         entry point: checks the Node version, then starts the server
server/index.ts         HTTP server (Hono): serves the page and the API, localhost only
server/proc.ts          starting and stopping other programs the same way on Windows, macOS and Linux
server/claude.ts        turns → Messages API request; streaming; prompt caching; error codes
server/cli.ts           the same through `claude -p` (Claude Code, e.g. with a subscription)
server/mcp.ts           MCP server for Claude Code: read (list, search, get context) and subagents (spawn, ask, fork…)
server/doc.ts           the document, owned by the server: revisions, applying changes from the page (patch) and
                        from the server's own writers (mutate), pushing every change to open pages
server/agent.ts         what agents do over MCP (spawn, ask, replay, operate…), carried out by the server; request
                        budget per run
server/replies.ts       every reply, yours and agents': one queue (a few at a time, each prompt after the replies above
                        it), written into the document, streamed to pages, stoppable
server/sample.ts        asking Claude from the server, with the same result as the page's sampler
server/context.ts       reads the saved tree on the server; builds context with treecore.js (files read from disk)
server/store.ts         SQLite in the app data folder: the state document, rolling snapshots, the token, the lock record
server/vault.ts         Encryption at rest and the password lock: data key kept in the keychain or wrapped by
                        scrypt(password), AES-256-GCM, recovery key, auto-lock
server/secrets.ts       The system keychain (macOS Keychain, Windows DPAPI, libsecret): the API key, the data key
server/redact.ts        Hides secrets in command output and diffs
server/schedule.ts      Scheduled tasks: when each runs, running them, and adding each result to its chat
server/config.ts        .env settings
```

## API

Every route below needs `Authorization: Bearer <token>` (the page keeps the token in localStorage and adds it to each
request; the event stream, which can't send headers, takes `?token=`), except `GET /api/auth`, `POST /api/auth/login`
and `POST /api/vault/unlock`. No cookies are used. With the data encrypted and locked, `/api/*` answers 423 and MCP
tools answer "Treechats is locked".

| Route | What it does |
|---|---|
| `GET /api/auth` | Whether this browser is signed in, and the encryption state: `{on, password, unlocked, autoLock, keychain}` |
| `POST /api/auth/login` | `{token}` or `{code}` (the one-time code from the link Treechats opens): returns `{token}` |
| `POST /api/vault/unlock` | `{password}`; or `{recovery}` (keychain mode, puts the key back in the keychain) or `{recovery, newPassword}` (password mode): unlocks and returns `{token}` |
| `POST /api/vault/enable` | `{}`: encryption with the key in the keychain; `{password, autoLock}`: the password lock (adds it to keychain-mode encryption without re-encrypting). Returns the recovery key when encryption was off |
| `POST /api/vault/disable`, `/nopassword` | Turn encryption off (decrypts everything), or drop the password lock and keep the key in the keychain |
| `POST /api/vault/password`, `/recovery`, `/settings`, `/lock`, `/alive` | Change the password, make a new recovery key, set the auto-lock, lock now, and count as activity |
| `GET /api/vault/fileskey` | While unlocked, the key the page encrypts attachments with |
| `POST /api/key/save`, `/move`, `/remove` | The API key in the system keychain |
| `POST /api/auth/reset` | A new token; other browsers and coding tools are signed out |
| `GET /api/schedule/status`; `POST /api/schedule/run` | Scheduled tasks (server/schedule.ts): when each last ran and runs next, and run one now. The tasks themselves are in the saved state (`opts.schedules`); a run adds its prompt and reply to the chat, and the event stream sends `scheduled` |

Requests that change something (`POST`/`PUT` under `/api/`) must be sent as `application/json`, which a page on
another site can't do without a CORS preflight that Treechats doesn't answer.
| `GET /api/config` | Which provider is active and ready, model labels for each tier, limits |
| `GET /api/state` | The document and its revision (`x-treechats-rev`) |
| `POST /api/state/patch` | `{base, ops, tab}`: the page's changes since revision `base`, as unit ops (docsync.js). Applied unless another writer changed the same unit since then; otherwise 409 with what was missed, so the page catches up and sends what's left |
| `GET /api/state/since/:rev` | The changes after a revision, or 409 when they're no longer all known (load the document again) |
| `PUT /api/state` | The whole document at once: the first save, or a restore; every open page loads it again |
| `GET /api/files`, `GET`/`PUT /api/files/:id` | Attached and project files |
| `GET /api/snapshots`, `GET /api/snapshots/:id` | Earlier saved states |
| `POST /mcp` | MCP (streamable HTTP, stateless). Read: `list_projects`, `list_chats`, `get_context`, `search`, `get_prompt`, `get_tree`, `list_saved_prompts`, and `btw` (a side question with a chat's context, answered by the server, changing nothing). Subagents: `spawn`, `ask`, `fork`, `edit_prompt`, `regenerate`, `leave_out`, `edit_reply`, `replay`, `loop`, `fan_out`, `review`, `judge`, `combine`, `distill`, plus `operate` (every other operation by name) and `describe`. `get_prompt` reports when the context above a reply has changed since it was written |
| `GET /api/agent/events` | Server-sent events for open pages: `doc` (a change to the document, with its ops), `genwait`, `gen` and `gendone` (a reply waiting, coming in, and done, with the revision that holds it), `scheduled`, `lock`, `vault` |
| `POST /api/replies` | `{sid, ids}`: write replies to these prompts (the page saves them first) |
| `POST /api/agent/stop` | `{sid, id}`: stop a reply being written (what came is kept), or cancel a waiting one with the prompts waiting below it |
| `POST /api/summarize` | `{sid, id, tpl?}`: write the summary that stands in for a turn's reply (Include as › Summary); answers when it's written |
| `POST /api/sample` | One request to Claude, streamed as newline-separated JSON: `{"t":"text","d"}` pieces, then `{"t":"done",…}` or `{"t":"error","code","message"}`. The page uses it for its ✦ tools (naming, fan out, checks); replies go through `/api/replies` |
| `POST /api/folder/list`, `/read`, `/write` | Folders (server/folders.ts): list files (git-aware), read them, write one back. Paths stay inside the folder; writes only go to folders linked to a project, never into `.git`, and refuse a disk copy that changed since it was read |
| `POST /api/folder/git`, `/diff` | Branch, changed files and diffs for a linked folder (server/run.ts), with secrets hidden |
| `POST /api/folder/run` | Runs a command in a linked folder; refused unless Settings › System allows it and the folder is linked, both checked against the saved state. Secrets in the output are hidden |
| `POST /api/sessions/list`, `/read`, `/parse` | Claude Code and Codex session logs as chats (server/sessions.ts), read-only |

## How the page's script is organised

The page began as a single-file claude.ai artifact. Its script is now split by topic into `web/src`, and the files
are joined back into one script (`app.js`), so they share one scope and need no imports: the code moved without being
rewritten. A source map keeps errors pointing at the right file. Turning files into ES modules with imports, one at a
time, is the natural next step where it helps; the shared files in `web/public` are already used by the server as
modules. `local-shim.js` marks the seam between the app and its environment (the server).
