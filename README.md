# Treechats

Branch, merge and rearrange chats with Claude, the way git handles code. Every prompt is a node in a
tree: continue from any point, try several directions side by side, fold a dead end away, merge two lines of
thought back together, and see exactly what context Claude gets from wherever you are.

Treechats runs on your own computer. Your chats are saved in a file on your machine, and replies come
either from your Anthropic API key or from your installed Claude Code (which can use a Claude subscription).

It's also a place to work on code with Claude: link a folder, review Claude's proposed changes as diffs, attach test
output and git diffs, open your Claude Code and Codex sessions as trees to see where their context went wrong, and
let coding agents use it over MCP.

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

## The basics

- **Two views.** **Editor** shows every chat as a tree, with an inspector for the selected prompt and every tool.
  **Chat** reads like any chat app: one conversation, replies in full, the input box at the bottom, and ‹ › to switch
  between branches. **Open in Editor** on any prompt jumps to it with its context in view.
- **Branch from anywhere.** Select any prompt and send: if it already has follow-ups, you get a new branch. Branches
  can be named, merged into each other (with a note so Claude reads the join), made the main line, or cloned into a
  new chat. The **branch map** (corner panel, or full size with **M**) draws the tree like a git graph.
- **Editing makes a branch.** Editing a prompt sends your version as a new branch with its own reply; the original
  keeps its branch and everything after it. **Regenerate** adds another reply as a new version, one ‹ › away.
- **Make replies easy to read.** Settings › Personalization › Claude’s replies sets the reply box apart from the
  theme: Plain, Gray, Blue, Green, High contrast or a color you pick. The text color follows the box, and the
  contrast ratio is shown.
- **Undo everything** with Ctrl/⌘-Z. **Ctrl/⌘-K** opens a palette with every command for the selected prompt.
- **Projects** group chats, and **Project files** are sent with every request in a project, like project knowledge in
  Claude. Search finds prompts and replies across a project, with filters for starred, noted and left-out prompts.

## Shape what Claude sees

- **See the exact context.** The inspector lists everything the selected prompt sends; `/context` breaks it down part
  by part with sizes against the request limit; **Copy as a prompt** copies it as one block to paste anywhere.
- **Leave out** a turn and it stops being sent from the prompts below (nothing is deleted). **Edit** one of Claude's
  replies and later prompts see your version, marked as edited.
- **Context changed.** Each reply remembers what it was sent, so after you change something above it, it shows a small
  note such as **Context changed: #3 reply edited** or **src/api.ts changed**. Only you see it; Claude never does,
  and you can turn it off in Settings.
- **Replay** re-sends from there, one prompt at a time, as new versions (the old ones stay one ‹ › away). Before each
  prompt a quick ✦ check asks whether it still makes sense after the new replies; if not, Replay stops with a
  suggested rewrite, or, if you choose, sends the rewrite and keeps going (marked as rewritten). After you send an
  edited prompt, **✦ Replay N below** carries over what followed the original.
- **Select a stretch** with Shift-click to copy just those turns, leave them all out, replay only them, replay them
  under another prompt, squash them into one, or splice them out. **Ctrl/⌘-click** picks prompts anywhere, to send
  the same follow-up to each (**Reply to several**) or compare them.

## Explore and decide

- **✦ Fan out** turns the options in a reply into one follow-up each, on its own branch. **Variants** sends your next
  prompt several ways (other wordings or models) at once.
- **Compare** shows follow-ups side by side, even across branches. **✦ Judge** gives a reason for each against
  criteria you type, plus a pick, and changes nothing. **✦ Combine** writes one reply from the best parts, with where
  each part came from, as a draft you edit before adding it.
- **✦ Review** starts a new chat that sees only a prompt and its reply (or the conversation up to it) and asks for an
  honest review. A reviewer that didn't write the answer has no reason to defend it; the two link to each other.
- **✦ Distill** writes a brief of the context so far: start a new chat from it, keep it as a note or project file, or
  add it to `CLAUDE.md` or `AGENTS.md` in a linked folder.

Every prompt Treechats sends on your behalf (✦ marks tools that use Claude) is shown before it's used and editable in
Settings › Prompts.

## Commands and saved prompts

Type `/` in the input box for commands, as in Claude Code (they're also in the Ctrl/⌘-K palette):
- `/btw question` asks a side question from the chat's context. The answer shows above the input box and nothing is
  added to the chat, unless you keep it as a branch.
- `/loop 3 Tighten it` sends a prompt again after each reply. Add `until: under 100 words` to stop when a quick check
  says the condition is met (its verdict is noted under each reply), or `every 10m` to wait between sends while
  Treechats is open.
- `/run npm test` and `/diff` work with linked folders (see Coding tools), and `/folder` adds one.
- `/context` and `/cost` show what the next prompt sends and what the chat has cost; `/rewind` goes back to an earlier
  prompt; `/model`, `/compact`, `/review`, `/branch`, `/clear`, `/memory`, `/search`, `/settings`, `/export` and
  `/help` do what they say. Anything else that starts with `/` is sent as written.

**Saved prompts** are your prompt library, listed after the commands when you type `/`, or under **Saved prompts**.
Words in `{braces}` are placeholders; what you've typed fills the first. A few starters are included (plan first, ask
me questions first, improve my prompt, critique your answer, and more). Edit them in Settings › Saved prompts.

## Folders and files

**Attach ▾ › A folder…** (or **Project files › a folder**, or `/folder`) adds a folder's files to the project or to
your next prompt. Treechats lists them with sizes against the request limit; `.gitignore` is respected, dependency
and build folders are skipped, and lock files and `.env` files start unticked.
- **Choose a folder** copies the files you tick.
- **Link a folder on this computer** (type its path) keeps them tied to the folder: **Sync** re-reads files that
  changed on disk, and replies written before the change say which file changed.

Click any file (in Project files, on a prompt, or waiting in the input box) to open it:
- syntax colors for about 60 languages, picked by extension or file name (`Dockerfile`, `Makefile`, `Gemfile`…),
  with line numbers, and Markdown and image previews (a Source / Preview switch for Markdown);
- **Edit** colors code as you type, with Tab and Ctrl/⌘-S. Saving makes a new version of the file: Undo brings the
  old one back, and earlier replies are marked "context changed". A linked file can also be saved back to disk; if
  the disk copy changed since Treechats read it, it is left alone unless you choose to overwrite it;
- **Copy**, and **Download** for files the browser holds the only copy of (a linked file is already on disk).

Files can be up to 300 KB each, and a folder lists up to 5,000.

## Coding tools

- **Open a Claude Code or Codex session as a chat.** In **Import chats**, **Coding sessions on this computer…** lists
  the sessions those tools have logged (or choose a `.jsonl` file). Each message you typed becomes a prompt; the
  reply shows what the agent wrote and each tool call with an excerpt of its result, with usage and cost. Rewinds are
  branches, and compactions are marked, since that is where the agent's context was rewritten. Read-only: nothing is
  written back to those logs. See where the context went wrong, then fork, leave turns out or replay.
- **Proposed changes.** When a reply has code for a project file (its path on the line before the block, in the
  block's first line, or a unified diff), it shows under the reply with +/− counts. **Review** opens a diff where each
  change can be kept or dropped, or the result edited, before it is saved as a new version of the file (and to disk,
  for a linked folder). When Claude shows only part of a file, it is placed where it matches. Any other code block
  can be applied to a file you choose. The note asking Claude to write changes this way is under Settings › Prompts,
  and shown in `/context`.
- **`/run npm test`** runs a command in a linked folder and shows the output above the input box, with **Attach to
  prompt**. Off until you turn it on in Settings › System; commands run on this computer with your permissions.
- **`/diff`** attaches git's view of changes in a linked folder: not committed (the default), `staged`, `last`
  (the latest commit), or any commit. Linked folders also show their branch and how many files changed.
- **Add to the repo:** **✦ Distill** can add the brief to `CLAUDE.md` or `AGENTS.md` in a linked folder, so the next
  coding session starts from what you worked out here.

## Model settings (advanced)

Turn them on in **Settings › System**. Then the inspector in Editor shows the settings in effect for the selected
prompt and lets you change them from there on: a system prompt, thinking, effort, temperature and reply length. Fork a
chat and change one setting to compare the same conversation under a different setup. Treechats sends only what the
model uses (newer models take effort, not temperature) and the reply says if something was skipped. Every reply also
shows its token counts and cost, with a running total along the context path (`/cost` sums a chat).

## Use it from coding tools (MCP)

Treechats serves an MCP server at `/mcp`. For Claude Code, add it once:

```
claude mcp add --transport http --scope user treechats http://localhost:5178/mcp
```

Settings › System has the setup for Cursor, VS Code and Codex too (only Claude Code is tested so far).

**Reading.** Ask for things like "get the context of the main branch of my rate limiter chat from treechats". It can
list projects and chats, search them, show a chat's whole shape (`get_tree`), and pull the context of a branch or
prompt: the same text as **Copy as a prompt** in the app. Files from linked folders are read from disk; other
attached files appear by name only, since their contents are kept in the browser. `btw` asks a side question with
the exact context of any of your chats and changes nothing; `list_saved_prompts` reads your prompt library.

**Subagents.** Coding agents can also run subagents in Treechats, chats whose context you can see and steer, with the
same tools you have:
- **Talk:** `spawn` (start one with exactly the context it should have), `ask`, `fork`, `edit_prompt`, `regenerate`,
  `loop` (the same prompt after each reply until a condition is met)
- **Shape context:** `leave_out`, `edit_reply`, `replay` (re-send after a change; stops at a prompt that no longer fits)
- **Explore and decide:** `fan_out`, `review` (a fresh-eyes second opinion), `judge` and `combine` (best-of-n across
  forks or any prompts), `distill` (bring back only a brief)
- **Everything else:** `operate` runs star, note, branch, rename, make mainline, merge, reroot, squash, splice, delete,
  rebase, cherry-pick, rename chat and model settings; `describe` lists their arguments.

For example: "use treechats to spawn three subagents that each review this design from a different angle, judge them
for correctness, then distill the best one".

- Each piece of work is a run with its own project, **Run: <name>**, where you can watch and step in. Agents can't
  change anything outside their run projects, and their changes stay out of your Undo.
- Everything an agent adds is labeled with its name (⚙).
- Each run may spend 60 model requests (`TREECHATS_AGENT_MAX_REQUESTS` in `.env`; the count resets when
  Treechats restarts).
- Subagents have no tools: they answer from the context they're given. `spawn` and `fork` take model settings
  (system prompt, thinking, effort, temperature, max tokens).
- For now the open Treechats page carries the changes out, so keep it open in your browser while an agent works.

Treechats must be running for any of this.

## Import and export

- **Import chats** (in the Ctrl/⌘-K palette, a project's **⋯ › Import / export JSON…**, or the link under a new
  chat's input box) reads chats pasted with speaker
  labels (`You:` / `Claude:`), Treechats' own Markdown export, the `conversations.json` from a Claude or ChatGPT data
  export (ChatGPT's edits and regenerations become versions), and Claude Code and Codex sessions.
- Copy a prompt's line or a whole chat as Markdown (`/export`), or the context as messages JSON. A project can be
  copied as JSON and imported elsewhere.

## Your data

- Chats, projects and settings: `data/treechats.db` (SQLite). A snapshot is kept every 10 minutes
  (the last 50), so a bad change can be recovered.
- Attached and project files: stored by your browser (IndexedDB). Files from a linked folder stay in that folder;
  Treechats keeps a copy and reads the folder again when you Sync.
- Nothing in `data/` or `.env` is ever committed; both are in `.gitignore`.

To bring spaces over from the claude.ai version (where projects were called spaces): in each space there, open
**Import / export › Copy this space as JSON**, then here open a project's **⋯ › Import / export JSON…**, paste it
and choose **Import pasted JSON as a new project**.

## Security

The server only listens on this computer (127.0.0.1), and only answers pages it served itself, so other
websites can't use it to spend your key, read your chats or reach your folders. The API key stays on the server and
is never sent to the browser.

- Linked folders: reads and writes stay inside the folder you linked, and a write never replaces a disk copy that
  changed since Treechats read it unless you say so.
- `/run` is off until you turn it on in Settings › System, and only runs in linked folders; the server checks both
  against the saved settings, not the request.
- Coding session logs are only read, never written.

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

See [docs/TOOLS.md](docs/TOOLS.md) for every tool and what it's for, [docs/VISION.md](docs/VISION.md) for where it's going, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and [docs/ROADMAP.md](docs/ROADMAP.md)
for what's next.
