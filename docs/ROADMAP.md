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
- Model settings (advanced, off by default): system prompt, thinking, effort, temperature and reply length for a
  prompt and the ones after it; the server sends only what each model uses and says what it skipped
- Token counts and cost on every reply, with a running total along the context path; thinking kept, folded
- Compare: ✦ Judge (a reason for every follow-up and a pick, against your criteria; changes nothing) and ✦ Combine
  (one reply from the best parts, as a draft you edit before adding; marked with its sources)
- Editing a prompt starts a new branch (Save in place is the exception)
- ✦ Review: a second opinion from a new chat that sees only what you include, linked both ways
- Saved prompts with {placeholders}, inserted with / ; starters for common strategies (plan first, interview me, …)
- MCP parity: edit_prompt, fan_out, get_tree, and operate/describe for every other operation
- MCP: replay, review, judge, combine and list_saved_prompts; spawn and fork take model settings; get_prompt reports settings, usage and
  context changes
- Include as (per-turn send modes): full, ✦ summary (editable, reviewable), excerpt (highlight parts of the prompt
  and reply, or word it yourself), prompt only, reply only, left out; nothing is deleted; MCP `include_as`
- See a ✦ request before it goes (always, or with Shift-click), with its wording editable for one use or as default
- Range selection (Shift-click) and picking prompts anywhere (Ctrl/⌘-click), each with a bar of what works on them
- One context builder: the tree and the request a prompt sends are defined once (treecore.js) for the page, MCP and
  scheduled tasks
- The server owns the document: files kept on the server; changes sent as small ops with revisions and merged per
  unit, so tabs, agents and scheduled tasks never overwrite each other; every change pushed to open pages; Undo
  rebased over other writers' changes
- Agent operations run on the server (the page relay is gone): MCP works with no page open; agents' replies stream to
  open pages; the ✦ tools are shared by the page and the server (treeops.js)

## Next
- Recipes; running a prompt over many inputs
- Try the subagent tools on a real task (Phase 1 below)

## Phase 1: subagents prototype
Test whether an orchestrating agent benefits from subagents whose context Treechats owns.
- MCP tools `spawn` (new chat from chosen context, a prompt and a model; returns the reply), `ask`
  (continue it), `distill` (return a brief), and the operations that matter most for steering a subagent:
  `fork`, `leave_out`, `edit_reply`, `regenerate`
- Agent runs go into their own project; every turn an agent creates is labeled with the agent's name
- Guardrails from day one: agents can only change their own run projects; a cap on requests per run; agent
  changes stay out of your Undo
- Prototype shortcut (since removed): writes were carried out by the open Treechats page, relayed by the server
- Try it on a real task, then decide what the agent interface should be before building more of it

## Phase 2: foundation
- Operations defined once and run where they're needed: done for context building, sync, agent operations and the
  ✦ tools; your own edits are still made in the page and sent as changes, and your replies are still requested by
  the page (a reply in progress stops if its tab closes)
- The tree stored as rows (projects, turns, branches) instead of one document; attachments in the database
- Turns made of content blocks (text, tool calls and results, thinking, images), provider-neutral
- Attribution and history for every change; permissions per project (read, suggest, write)
- Context fingerprint, the rest of it (the marker itself is done): opt-in checks for agents ("only if the context is
  still ab12…"), cache awareness (where two requests' prefixes diverge) and reproducibility. Identity stays numeric
  (#12) and branch names; no git-style content addressing
- A small CLI over the same operations (MCP writes without the page open: done)

## Phase 3: reuse and agents in full
- For agents: history per run with undo; a Runs view of agent runs
- Import Claude Code sessions as trees (read-only import; writing sessions back is not a public interface)

## Later
- Cost: start one fan-out request first so the others read the shared start from the prompt cache (confirm cache
  timing first); warn when a chat is too short for the model to cache
- Recipes (saved pipelines of tools), sweeps across models or contexts, re-running saved contexts as evals
- Export a branch as a standalone page; select several prompts at once
- Other model providers; hosted and multi-user (open questions in the vision)
- The same prompt with and without some context, side by side (A/B)
