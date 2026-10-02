# Treechats

Branch, merge and rearrange conversations with Claude, the way git handles code. Every prompt is a node in a
tree: continue from any point, try several directions side by side, fold a dead end away, merge two lines of
thought back together, and see exactly what context Claude gets from wherever you are.

Treechats runs on your own computer. Your conversations are saved in a file on your machine, and replies come
either from your Anthropic API key or from your installed Claude Code (which can use a Claude subscription).

## Run it

Treechats runs on Windows, macOS and Linux. You need [Node.js](https://nodejs.org) 22.13 or newer; the current
LTS is a good choice (on a Mac, `brew install node` works too).

**The easy way:** double-click **`start-treechats.cmd`** (Windows) or **`start-treechats.command`** (Mac) in this
folder. The first run installs what it needs, then Treechats opens in your browser. Close the window to stop it.

**From a terminal:** open one in this folder (in GitHub Desktop: **Repository › Open in Command Prompt** on
Windows, **Open in Terminal** on a Mac), then:

```
npm install
npm start
```

Treechats opens at <http://localhost:5178>. Stop it with Ctrl+C.

> On Windows, if PowerShell says running scripts is disabled when you type `npm`, use the Command Prompt
> instead, or type `npm.cmd` in place of `npm`.

## Choose where replies come from

Copy `.env.example` to `.env` (Windows: `copy .env.example .env`, Mac: `cp .env.example .env`), then pick one:

- **Your Claude subscription, through Claude Code.** Install [Claude Code](https://code.claude.com/docs/en/setup),
  run `claude` once in a terminal and sign in with your Claude account. Leave `ANTHROPIC_API_KEY` empty.
  Treechats finds `claude` on your PATH or in the folders its installers use; if yours is somewhere else, set
  `TREECHATS_CLAUDE_PATH` to its full path.
  Treechats runs `claude -p` for each reply, with Claude Code's tools, MCP servers and memory turned off, so it
  answers like a plain chat. Replies count toward your subscription's usage limits.
- **An API key.** Put your key from the [Claude Console](https://platform.claude.com/settings/keys) in
  `ANTHROPIC_API_KEY`. Usage is billed to your Console account. This route sends real conversation turns, uses
  prompt caching (branches share their beginnings, so repeat context is cheap), and supports images directly.

With `TREECHATS_PROVIDER=auto` (the default) Treechats uses the API key when there is one, and Claude Code
otherwise. Restart Treechats after changing `.env`.

The model behind each tier (Quick, Default, Complex) is set in `.env` too.

> Using Claude Code with your subscription is meant for your own use on your own machine. If Treechats is ever
> shared with other people, they should use their own API keys: Anthropic doesn't allow third-party apps to
> offer claude.ai sign-in without approval.

## Your data

- Conversations, spaces and settings: `data/treechats.db` (SQLite). A snapshot is kept every 10 minutes
  (the last 50), so a bad change can be recovered.
- Attached files: stored by your browser for now (IndexedDB).
- Nothing in `data/` or `.env` is ever committed; both are in `.gitignore`.

To bring spaces over from the claude.ai version: in each space there, open **Import / export › Copy this space
as JSON**, then here paste it and choose **Import pasted JSON as a new space**.

## Security

The server only listens on this computer (127.0.0.1), and only answers pages it served itself, so other
websites can't use it to spend your key or read your conversations. The API key stays on the server and is
never sent to the browser.

## Develop

```
npm run dev     # server with auto-restart, page with live reload at http://localhost:5179
npm test        # tests
npm run check   # type check
```

Set `TREECHATS_FAKE=1` to get canned replies without calling Claude. Every push runs the type check, the build
and the tests on Windows, macOS and Linux with Node 22 and 24 (`.github/workflows/ci.yml`); the tests start the
real server and drive a stand-in `claude` CLI, including stopping a reply mid-way.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and [docs/ROADMAP.md](docs/ROADMAP.md)
for what's next.
