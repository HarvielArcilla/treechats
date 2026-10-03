# Treechats

Branch, merge and rearrange chats with Claude, the way git handles code. Every prompt is a node in a
tree: continue from any point, try several directions side by side, fold a dead end away, merge two lines of
thought back together, and see exactly what context Claude gets from wherever you are.

Treechats runs on your own computer. Your chats are saved in a file on your machine, and replies come
either from your Anthropic API key or from your installed Claude Code (which can use a Claude subscription).

## Run it

Treechats runs on Windows, macOS and Linux. You need [Node.js](https://nodejs.org) 22.13 or newer; the current
LTS is a good choice (on a Mac, `brew install node` works too).

**The easy way:** double-click **`start-treechats.cmd`** (Windows) or **`start-treechats.command`** (Mac) in this
folder. The first time, it offers to install anything missing (Node.js, and Claude Code if you want replies
from your Claude subscription), signs you in to Claude Code, then opens Treechats in your browser. Close the
window to stop it.

Each start also pulls the latest version from GitHub when git is installed and you haven't changed files here.

**From a terminal:** open one in this folder, then:

```
npm install
npm start
```

Treechats opens at <http://localhost:5178>. Stop it with Ctrl+C. To update: `git pull`, then `npm start` again.

Getting it the first time: `git clone https://github.com/HarvielArcilla/treechats.git`. On Windows, if `git`
isn't found, install it with `winget install --id Git.Git -e` and open a new terminal.

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
  `ANTHROPIC_API_KEY`. Usage is billed to your Console account. This route sends real chat turns, uses
  prompt caching (branches share their beginnings, so repeat context is cheap), and supports images directly.

With `TREECHATS_PROVIDER=auto` (the default) Treechats uses the API key when there is one, and Claude Code
otherwise. Restart Treechats after changing `.env`.

The model behind each tier (Quick, Default, Complex) is set in `.env` too.

> Using Claude Code with your subscription is meant for your own use on your own machine. If Treechats is ever
> shared with other people, they should use their own API keys: Anthropic doesn't allow third-party apps to
> offer claude.ai sign-in without approval.

## Change context, then replay

Fix an earlier prompt, correct one of Claude's replies, or leave a turn out, and every reply below it now rests on
context that has changed. Each reply remembers what it was sent, so it shows a small note, such as **Context
changed: #3 reply edited** (only you see it; Claude never does, and you can turn it off in Settings). Click
**Replay** to re-send from there, one prompt at a time: each gets a new reply as a new version, and the old ones stay
one ‹ › away. A new reply can go a different way, so before each prompt a quick ✦ check asks whether it still makes
sense. If it doesn't, Replay stops and shows why, with a suggested rewrite you can edit, send as is, or stop at; or,
if you choose, it sends the rewrite and keeps going (the prompt is marked as rewritten and keeps your wording). You can also replay any stretch with **✦ Replay from here** under a selected prompt, and after you send
an edited prompt, the prompts that followed the original can be carried over with **✦ Replay N below**.

## Second opinions and saved prompts

**✦ Review** on a reply starts a new chat that sees only that prompt and reply (or, if you choose, the conversation
up to it) and asks for an honest review. A reviewer that didn't write the answer has no reason to defend it. The review
prompt is shown before it's sent and editable in Settings › Prompts, and the reply and its review link to each other.

**Saved prompts** are your prompt library: insert one from **Saved prompts** under the input box, or type `/` in an
empty box. Words in `{braces}` are placeholders; what you've typed fills the first. A few starters are included (plan
first, ask me questions first, improve my prompt, critique your answer, and more). Edit them in Settings › Saved
prompts.

## Compare, judge and combine

Open **Compare** on a prompt with several follow-ups to read them side by side. **✦ Judge** sends one request with
the context and each follow-up's reply, and gets back a reason for each against criteria you type, plus a pick; it
changes nothing. **✦ Combine** writes one reply from the best parts, with the follow-up it answers and where each
part came from, as a draft you edit before adding it as a new follow-up (marked as combined).

## Branch settings (advanced)

Turn them on in **Settings › System**. Then the inspector in Editor shows the settings in effect for the selected
prompt and lets you change them from there on: a system prompt, thinking, effort, temperature and reply length. Fork a
chat and change one setting to compare the same conversation under a different setup. Treechats sends only what the
model uses (newer models take effort, not temperature) and the reply says if something was skipped. Every reply also
shows its token counts and cost, with a running total along the context path.

## Use it from Claude Code (MCP)

Treechats serves an MCP server at `/mcp`, so Claude Code can read your chats while you work. Add it once:

```
claude mcp add --transport http --scope user treechats http://localhost:5178/mcp
```

**Reading.** Ask for things like "get the context of the main branch of my rate limiter chat from
treechats". It can list projects and chats, search them, and pull the context of a branch or prompt: the
same text as **Copy as a prompt** in the app. Attached files appear by name only, since their contents are kept
in the browser.

**Subagents.** Claude Code can also run subagents in Treechats, chats whose context you can see and
steer: `spawn` (start one with exactly the context it should have), `ask`, `fork`, `leave_out`, `edit_reply`,
`regenerate`, `replay` (re-send from a prompt once the context above it has changed; it stops at a prompt that no
longer fits, or rewrites it if asked), `review` (a fresh-eyes second opinion), `judge` and `combine` (best-of-n across forks) and `distill`; `list_saved_prompts` reads your prompt library (get back a short brief instead of the whole chat). For example: "use
treechats to spawn three subagents that each review this design from a different angle, then distill each".

- Each piece of work is a run with its own project, **Run: <name>**, where you can watch and step in. Agents can't
  change anything outside their run projects, and their changes stay out of your Undo.
- Everything an agent adds is labeled with its name (⚙).
- Each run may spend 60 model requests (`TREECHATS_AGENT_MAX_REQUESTS` in `.env`; the count resets when
  Treechats restarts).
- Subagents have no tools: they answer from the context they're given. `spawn` and `fork` take branch settings
  (system prompt, thinking, effort, temperature, max tokens).
- For now the open Treechats page carries the changes out, so keep it open in your browser while an agent works.

Treechats must be running for any of this.

## Your data

- Chats, projects and settings: `data/treechats.db` (SQLite). A snapshot is kept every 10 minutes
  (the last 50), so a bad change can be recovered.
- Attached files: stored by your browser for now (IndexedDB).
- Nothing in `data/` or `.env` is ever committed; both are in `.gitignore`.

To bring spaces over from the claude.ai version (where projects were called spaces): in each space there, open
**Import / export › Copy this space as JSON**, then here open a project's **⋯ › Import / export JSON…**, paste it
and choose **Import pasted JSON as a new project**.

## Security

The server only listens on this computer (127.0.0.1), and only answers pages it served itself, so other
websites can't use it to spend your key or read your chats. The API key stays on the server and is
never sent to the browser.

## Develop

```
npm run dev     # server with auto-restart, page with live reload at http://localhost:5179
npm test        # tests
npm run check   # type check
```

Set `TREECHATS_FAKE=1` to get canned replies without calling Claude (and `TREECHATS_FAKE_DELAY=60` to slow them down
enough to watch them stream). Every push runs the type check, the build
and the tests on Windows, macOS and Linux with Node 22 and 24 (`.github/workflows/ci.yml`); the tests start the
real server and drive a stand-in `claude` CLI, including stopping a reply mid-way.

See [docs/VISION.md](docs/VISION.md) for where it's going, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and [docs/ROADMAP.md](docs/ROADMAP.md)
for what's next.
