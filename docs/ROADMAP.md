# Roadmap

The direction is in [VISION.md](VISION.md). Work is ordered to test the riskiest idea cheaply first (subagents), then build the server-side
foundation once the agent interface has been tried on a real task, then everything that builds on it.

## Done
- Runs locally with your API key or Claude Code (subscription); saved to SQLite with snapshots; Windows, macOS, Linux
- Replies side by side with a queue; full Markdown, math and highlighted code
- Chat view: one chat as a chat thread, with branch switching and merges you can open
- Branch map: git-style graph in the panel, full size with M
- Context tools: edit Claude's replies, copy context as a prompt, ✦ Distill into a brief
- Every prompt Treechats sends is editable (Settings › Prompts); ✦ marks tools where Claude does the work
- MCP server, read-only: list, search, get the context of a branch or prompt, get a prompt
- Context fingerprint: each reply records a hash of exactly what was sent, and shows a small, neutral "Context
  changed: #3 reply edited" note when something above it changes (never sent to the model; can be turned off)
- Replay: re-send a prompt and the ones below it against the context as it is now, one at a time, as new versions,
  after saying what it can cost; a quick ✦ check before each prompt stops at one that no longer fits (or rewrites
  it, if chosen, marked and with the original kept); also carries the prompts below an edited prompt over to its
  new version
- Branch settings (advanced, off by default): system prompt, thinking, effort, temperature and reply length for a
  prompt and the ones after it; the server sends only what each model uses and says what it skipped
- Token counts and cost on every reply, with a running total along the context path; thinking kept, folded
- Compare: ✦ Judge (a reason for every follow-up and a pick, against your criteria; changes nothing) and ✦ Combine
  (one reply from the best parts, as a draft you edit before adding; marked with its sources)
- Editing a prompt starts a new branch (Save in place is the exception)
- ✦ Review: a second opinion from a new chat that sees only what you include, linked both ways
- Saved prompts with {placeholders}, inserted with / ; starters for common strategies (plan first, interview me, …)
- MCP: replay, review, judge, combine and list_saved_prompts; spawn and fork take branch settings; get_prompt reports settings, usage and
  context changes

## Next
- `fan_out` over MCP, so agents can branch a reply's options the way people do
- Range selection (Shift-click) with tools for a stretch of a line; recipes; running a prompt over many inputs
- Try the subagent tools on a real task (Phase 1 below)

## Phase 1: subagents prototype
Test whether an orchestrating agent benefits from subagents whose context Treechats owns.
- MCP tools `spawn` (new chat from chosen context, a prompt and a model; returns the reply), `ask`
  (continue it), `distill` (return a brief), and the operations that matter most for steering a subagent:
  `fork`, `leave_out`, `edit_reply`, `regenerate`
- Agent runs go into their own project; every turn an agent creates is labeled with the agent's name
- Guardrails from day one: agents can only change their own run projects; a cap on requests per run; agent
  changes stay out of your Undo
- Prototype shortcut: writes are carried out by the open Treechats page (the server relays them), so operations
  keep their single definition in the page for now; if the page isn't open, the tools say so
- Try it on a real task, then decide what the agent interface should be before building more of it

## Phase 2: foundation
- Each operation defined once in TypeScript and run on the server; the page becomes a client (removes the
  duplicate context building and the page-relay shortcut)
- The tree stored as rows (projects, turns, branches) instead of one document; attachments in the database
- Turns made of content blocks (text, tool calls and results, thinking, images), provider-neutral
- Attribution and history for every change; permissions per project (read, suggest, write)
- Context fingerprint, the rest of it (the marker itself is done): opt-in checks for agents ("only if the context is
  still ab12…"), cache awareness (where two requests' prefixes diverge) and reproducibility. Identity stays numeric
  (#12) and branch names; no git-style content addressing
- MCP writes without the page open; a small CLI over the same operations

## Phase 3: reuse and agents in full
- Full parity for agents: an `operate` tool for every other operation, with `describe` for arguments; history per run with undo; a Runs view of agent runs
- Import Claude Code sessions as trees (read-only import; writing sessions back is not a public interface)

## Later
- Cost: start one fan-out request first so the others read the shared start from the prompt cache (confirm cache
  timing first); warn when a chat is too short for the model to cache
- Per-turn send modes (full, prompt only, summary, left out); reversible summaries
- Recipes (saved pipelines of tools), sweeps across models or contexts, re-running saved contexts as evals
- Export a branch as a standalone page; select several prompts at once
- Other model providers; hosted and multi-user (open questions in the vision)
- Harder: keep only part of a reply; the same prompt with and without some context (A/B)
