# Vision

**Treechats is precise context control for power users, and for the agents they work with.**

On the surface it is a familiar chat (Simple view). Underneath, every conversation is a version-controlled tree of
turns, and you decide exactly what Claude sees on each request. The primary audience is technical people who want
that control. Agents are a second kind of user of the same controls, working under the person's supervision.

## Principles

1. **What you see is what's sent.** Every byte that reaches the model can be inspected. No hidden prompts: every
   piece of text Treechats sends on your behalf is visible and editable (Settings › Prompts).
2. **Context is data.** Turns are addressable (#12, `main`), versioned, diffable and scriptable. Anything you can
   do in the interface, a program can do too (MCP, later a CLI and local API).
3. **Nothing is lost.** Edits make versions, AI rewrites are reviewable, Undo always works.
4. **Who wrote what is visible.** Every turn shows whether you wrote it, Claude wrote it, you edited Claude's
   words, or an agent made the change; plus the model and the context it was written with.
5. **AI actions are marked and reviewable.** ✦ marks tools where Claude does the work. Tools that rewrite your
   context show their result before it enters the tree.
6. **Depth on demand.** Chat, then tree, then inspector, then automation. Each layer is optional.

## Agents

Context management is where agents struggle most: long sessions fill up, automatic compaction is lossy and opaque,
failed attempts keep misleading the model. The operations Treechats gives people (branch, leave out, distill and
restart, pin, replay) are the ones agents need too: explicit, named, reversible.

Treechats can only control context that lives in Treechats. A Claude Code session manages its own context window,
so the plan is not to reach into it, but to give it **subagents whose context Treechats owns**:

- An orchestrating agent (e.g. Claude Code) uses the Treechats MCP server to **spawn** subagent conversations
  from chosen context, **ask** them follow-ups, **fork** them to try alternatives side by side, **edit** their
  context (leave out, correct, pin, replay), **distill** what they found into a brief, and **compare/judge** forks.
- Only briefs flow back to the orchestrator, so its own context stays small; the detail stays inspectable in
  Treechats.
- Each orchestrator task is its own space: subagents are conversations, forks are branches. You can watch the run
  in the branch map and step in: fix a subagent's assumption, leave out a dead end, have the run continue from your
  version.
- These are **thinking subagents without tools**: analysis, planning, review, design comparison, critique of
  material passed to them. Tool-using work (reading files, running commands) stays with Claude Code's own
  subagents. Treechats manages context; it does not execute tools.

Rules that keep the person in control:
- Agents work on branches and in their own spaces; they never change your conversations in place unless allowed.
- Every change is attributed (you, Claude in a chat, or a named agent) and undoable, with a history of what
  agents did.
- Permissions per space: read only, suggest (writes go to branches or a review queue), or write.

## Architecture this implies

1. **One definition of each operation**, in TypeScript on the server, used by the UI, MCP and a CLI. Today context
   building exists twice (page and server) with a parity test as a stopgap.
2. **The server holds the tree** as rows (spaces, turns, branches), with the page as one client. Needed for agent
   writes without the page open, and for a hosted version later.
3. **Turns made of content blocks** (text, tool calls and results, thinking, images), so agent traces and other
   providers fit without a migration later.
4. **Manage, don't run:** Treechats owns conversation history and context; tool execution belongs to Claude Code or
   the Agent SDK.

## UI shape

Three views of the same data: **Chat** (Simple view) for everyday use, **Workbench** (tree, map, inspector,
context blocks) for precise context work, **Runs** (agent runs step by step, with "fork here"). Tools that move
text live inline on prompts and replies; ✦ tools that rewrite context get a review step.

## Open questions

- Claude only, or any model? Context editing is model-agnostic; keep the turn format provider-neutral either way.
- Stay local and single-user, or work toward hosted and multi-user?
- How much control the Agent SDK gives over message history (for agents whose own loop runs through Treechats).

See [ROADMAP.md](ROADMAP.md) for the order of work.
