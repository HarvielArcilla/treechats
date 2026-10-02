# Roadmap

## 1. Runs locally (done)
- Local server with your API key or Claude Code (subscription) for replies
- Conversations saved to SQLite on disk, with snapshots
- The full app from the claude.ai version

## 2. Restructure
- Split `web/index.html` into TypeScript modules: tree model and operations (with tests), persistence,
  Claude client, and screens
- Redraw only what changed instead of the whole tree on every action
- Store spaces and prompts as rows instead of one document, so saving is incremental
- Move attachments from the browser into the database

## 3. Use the API fully
- Real system prompts instead of the leading "standing instructions" turn
- Real token counts for the context meter (count tokens endpoint), and cost per reply
- Model choice by name, not only tiers
- Extended thinking, and showing it

## 4. Editors and coding tools
- MCP server, read-only (done): Claude Code can list spaces and conversations, search, and pull the context of
  a branch or prompt
- MCP writes: add a prompt, save a brief, start a conversation from a Claude Code session. Needs the page to pick
  up changes made on the server
- Space and attached files on the server, so MCP context includes their contents (today: names only)
- Editor panel (VS Code webview)

## 5. Context editing
Treechats is a context editor: deciding what Claude sees on each turn, cheaply, instead of restarting chats until
the context is right. Done so far: edit Claude's replies (marked "edited by you"), copy context as a prompt,
distill a branch into a brief.

Also done: the branch map (a git-style graph of the conversation in the panel, full size with M).

Next, roughly in order of value for the effort:
- "Written before this changed" marker: record what context each reply was written with, flag replies whose
  context has since changed
- Replay: re-run the prompts below a point against the edited context, as new versions, with a preview of how
  many requests it takes
- Context blocks: reusable pieces (brief, style guide, key files, instructions) switched on per conversation
- Per-turn send modes: full, prompt only, summary, left out
- Reversible summaries: send a summary for a stretch while keeping the originals
- Cost awareness: show which part of the context will come from the prompt cache and what an edit will re-send
  at full price (editing early turns breaks the cache from that point on)

Harder, later: keep only a selected part of a reply; send the same prompt with and without some context (A/B);
write edited Claude Code sessions back for `--resume` (the session format isn't a public interface).

UI to decide when these land: tools that only move text (copy, leave out, send modes) belong inline on prompts
and replies; tools that ask Claude to rewrite context (distill, summaries, replay) may want a dedicated view
where you can review and edit Claude's output before it enters the tree.

## Ideas waiting their turn
- "Written before this changed" marker after editing an earlier prompt
- In Compare: "Ask which is best" and "Combine into one"
- Instructions per conversation
- Export a branch as a standalone page
- Select several prompts to delete, leave out or copy at once
- Automatic conversation titles (first pass exists under Settings › Naming)
