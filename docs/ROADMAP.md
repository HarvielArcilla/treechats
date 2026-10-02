# Roadmap

The direction is in [VISION.md](VISION.md). Work is ordered to test the riskiest idea cheaply first (subagents), then build the server-side
foundation once the agent interface has been tried on a real task, then everything that builds on it.

## Done
- Runs locally with your API key or Claude Code (subscription); saved to SQLite with snapshots; Windows, macOS, Linux
- Replies side by side with a queue; full Markdown, math and highlighted code
- Simple view: one conversation as a chat thread, with branch switching and merges you can open
- Branch map: git-style graph in the panel, full size with M
- Context tools: edit Claude's replies, copy context as a prompt, ✦ Distill into a brief
- Every prompt Treechats sends is editable (Settings › Prompts); ✦ marks tools where Claude does the work
- MCP server, read-only: list, search, get the context of a branch or prompt, get a prompt

## Phase 1: subagents prototype
Test whether an orchestrating agent benefits from subagents whose context Treechats owns.
- MCP tools `spawn` (new conversation from chosen context, a prompt and a model; returns the reply), `ask`
  (continue it), `distill` (return a brief), and the operations that matter most for steering a subagent:
  `fork`, `leave_out`, `edit_reply`, `regenerate`
- Agent runs go into their own space; every turn an agent creates is labeled with the agent's name
- Guardrails from day one: agents can only change their own run spaces; a cap on requests per run; agent
  changes stay out of your Undo
- Prototype shortcut: writes are carried out by the open Treechats page (the server relays them), so operations
  keep their single definition in the page for now; if the page isn't open, the tools say so
- Try it on a real task, then decide what the agent interface should be before building more of it

## Phase 2: foundation
- Each operation defined once in TypeScript and run on the server; the page becomes a client (removes the
  duplicate context building and the page-relay shortcut)
- The tree stored as rows (spaces, turns, branches) instead of one document; attachments in the database
- Turns made of content blocks (text, tool calls and results, thinking, images), provider-neutral
- Attribution and history for every change; permissions per space (read, suggest, write)
- MCP writes without the page open; a small CLI over the same operations

## Phase 3: reuse and agents in full
- Context blocks switched on per conversation, with instructions per conversation as one kind of block
- Full parity for agents: an `operate` tool for every other operation, with `describe` for arguments; pin,
  `compare`/`judge`; history per run with undo; a Runs view of agent runs
- Replay: re-run the prompts below a point against edited context, as new versions, with a preview of how many
  requests it takes (for agents steering subagents, and for people)
- Import Claude Code sessions as trees (read-only import; writing sessions back is not a public interface)

## Later
- "Written before this changed" markers: each reply records the context it was written with; flagged when that
  context changes
- Cost: start one fan-out request first so the others read the shared start from the prompt cache (confirm cache
  timing first); warn when a conversation is too short for the model to cache
- Per-turn send modes (full, prompt only, summary, left out); reversible summaries
- Request settings per branch: system prompt, temperature, thinking, max tokens; real token counts and cost
- Recipes (saved pipelines of tools), sweeps across models or contexts, re-running saved contexts as evals
- In Compare: "Ask which is best" and "Combine into one"
- Export a branch as a standalone page; select several prompts at once
- Other model providers; hosted and multi-user (open questions in the vision)
- Harder: keep only part of a reply; the same prompt with and without some context (A/B)
