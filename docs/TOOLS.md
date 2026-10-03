# Tools

Every tool in Treechats: what it does, the need it meets, and how often I expect it to be used. ✦ marks tools where
Claude does the work; each use sends a request.

**Expected use:**
- **Core:** almost every session.
- **Common:** most people, most weeks.
- **Power:** people who chose Treechats for context control, regularly.
- **Rare:** occasional, or a specific situation. These are candidates to tuck away, not to delete.

## Tools on one prompt

### Talking

| Tool | Where | What it does | Need | Use |
|---|---|---|---|---|
| Send | Input box | Adds your prompt after the selected one and gets a reply; forks if that prompt already has follow-ups | The conversation itself | Core |
| Edit (prompt) | Under the prompt | Your edit becomes a new version on its own branch, with a reply. The original keeps its branch and what followed. *Save in place* (Editor) changes the text without a reply | "Edit, don't argue": fix the question instead of correcting the answer | Core |
| Regenerate | Under the reply | Another reply to the same prompt, as a new version; ‹ › flips between them | A bad or unlucky reply | Core |
| ‹ › version and branch switcher | Under the prompt | Moves between versions of a prompt and the branches from it | Navigating what Edit, Regenerate and forks create | Core |
| Copy (prompt or reply) | Under each | Copies the text | Taking an answer elsewhere | Core |
| Attach files | Input box | Text, code or images sent with the prompt | Giving Claude the material | Common |
| Saved prompts | Input box, or `/` | Inserts a prompt from your library; what you typed fills its first `{placeholder}` | Reusing prompts that work: plan first, interview me, critique, … | Common |
| Model picker | Input box | Quick, Default or Complex for the next reply | Cost against quality | Common |

### Shaping what Claude sees

| Tool | Where | What it does | Need | Use |
|---|---|---|---|---|
| Edit (reply) | On the reply | Change what Claude said; later prompts see your version, marked "edited" | Correcting a fact or a wrong assumption so it stops spreading | Power |
| Leave out | Operations, inspector | Stops sending a turn from the prompts below; nothing is deleted | Dropping a dead end or a misleading tangent | Power |
| Context changed (marker) | On replies | Says what changed above a reply since it was written (e.g. "#16 reply edited") | Knowing which replies are out of date after you edit context | Power (automatic) |
| ✦ Replay from here | Under the prompt, the marker | Re-sends the prompt and the ones after it, one at a time, as new versions. A quick check stops at a prompt that no longer fits | Regenerating what followed after you change the context | Power |
| Model settings | Inspector (Settings › System to turn on) | System prompt, thinking, effort, temperature, reply length from this prompt on | Trying the same chat under a different setup | Rare (advanced) |
| Copy as a prompt / Markdown / JSON | Inspector | The exact context from the selected prompt, as one block | Moving context into another tool or chat | Common |

### Exploring

| Tool | Where | What it does | Need | Use |
|---|---|---|---|---|
| ✦ Fan out | Under the reply | Turns the options in a reply into one follow-up each, on its own branch; you choose which | "Give me options, then pursue each" | Power |
| Variants | Operations | Sends your next prompt several ways (other wordings or models), each on its own branch | Comparing wordings or models on one question | Rare |
| ✦ Review | Under the reply | A new chat that sees only this prompt and reply (or the conversation up to it) reviews it; linked both ways | A second opinion from fresh eyes | Common |
| ✦ Distill | Under the reply, inspector | A brief of the context up to here: start a new chat with it, save as note or project file, or copy | Starting fresh without losing what mattered | Power |
| Branch, Make mainline, Rename, Check out | Operations, branch label, map | Name and manage lines of work | Keeping track of parallel attempts | Power |
| Star, Note | On the prompt, inspector | Mark and annotate; notes are never sent to Claude | Finding decisions later | Common |
| Hide N below / Show | Under the prompt | Folds what follows, in view only | Reading a long tree | Common |
| Open in Editor | Chat view, under the prompt | Switches to Editor with that prompt selected | Going from chatting to precise work | Common |

### Restructuring (Editor, Operations)

| Tool | What it does | Need | Use |
|---|---|---|---|
| Merge into… / Undo merge | Brings one branch into another, with a note so Claude reads the join | Combining two lines of thought | Power |
| Clone… | Copies a prompt's path, its subtree, or the whole chat into a new chat | Starting a variant chat from a known point | Power |
| Squash | Collapses a run of prompts into one | Shortening a settled stretch | Rare (easier as a stretch, below) |
| Reroot | Cuts a prompt from what came before, optionally with a summary root | Dropping early context entirely | Rare |
| Splice out | Removes one prompt; its follow-ups attach to its parent | Removing one bad turn | Rare |
| Delete subtree | Deletes a prompt and everything after it | Cleaning up | Common |
| Rebase onto… | Moves a prompt and what follows under another prompt | Re-parenting work | Rare |
| Cherry-pick | Copies a prompt's text under another prompt | Reusing one question elsewhere | Rare |

## Commands (type `/` in the input box)

The input box takes commands like Claude Code's. Typing `/` lists them, then your saved prompts; Tab fills one in,
Enter runs it. Each one maps onto a tool above, or is a small one of its own. Anything else that starts with `/` is
sent as written. They are also in the command palette (Ctrl/⌘-K).

| Command | What it does | Need | Use |
|---|---|---|---|
| `/btw question` | ✦ Claude answers from this chat's context; nothing is added to the chat. *Keep as a branch* saves the question and answer as a branch, without moving you | A quick aside that shouldn't clutter the context | Common |
| `/loop [times] [every 10m] prompt [until: condition]` | ✦ Sends the same prompt again after each reply on this line. Stops after *times* (default 3), when a quick check says the condition is met (its verdict is noted under each reply), or when you stop it. *every* waits between sends while Treechats is open | "Keep improving it until…", polishing passes, periodic checks | Power |
| `/context` | What the next prompt sends, part by part (system prompt, instructions, project files, prompts, replies, files), with the largest turns | Knowing what to leave out before the limit bites | Power |
| `/cost` | Tokens and cost on this line and in the whole chat | Keeping an eye on spend | Common |
| `/model [quick\|default\|complex]` | Sets the model for next replies | Switching without the menu | Common |
| `/rewind` | Lists earlier prompts on the line; choosing one continues from it, so the next send forks there | Going back without losing anything | Common |
| `/compact` | ✦ Distill, then a fresh chat from the brief | A long chat that has lost focus | Power |
| `/review [what to check]` | ✦ Review, with your instructions | A second opinion | Common |
| `/branch name` | Renames the branch you're on, or starts one here | Naming a line of work | Power |
| `/clear` | A new chat; this one stays | Starting fresh | Common |
| `/memory` | Settings › Prompts, at the standing instructions (Treechats' CLAUDE.md) | Instructions for every request | Rare |
| `/search words`, `/settings`, `/export`, `/help` | Search, Settings, copy the line as Markdown, list commands | Getting around | Common |

## Tools on several prompts

### A stretch of a line (Shift-click)

Select from the selected prompt to the clicked one, inclusive. These tools need consecutive turns, because order and
position matter.

| Tool | What it does | Need | Use |
|---|---|---|---|
| Copy as a prompt | Just those turns, as one block | Sharing one part of a conversation | Common |
| Leave out / Include | All of them at once | Dropping a whole tangent | Power |
| ✦ Replay this stretch | Re-sends those prompts with today's context and stops at the last one | Regenerating one part, not everything after it | Power |
| ✦ Replay onto… | Re-sends the stretch under another prompt, one at a time, with the fit check | Running a sequence you liked in a different context (the core of recipes) | Power |
| Squash | Collapses the stretch into one prompt and reply | Shortening a settled stretch | Rare |
| Splice out | Removes the stretch; what follows attaches above it | Cutting a multi-turn detour | Rare |

### Prompts picked anywhere (Ctrl/⌘-click)

| Tool | What it does | Need | Use |
|---|---|---|---|
| Reply to several | Sends your next prompt after each picked prompt, each on its own branch | Asking the same follow-up of several attempts | Power |
| Compare these | The picked prompts and replies side by side, even across branches | Weighing attempts that aren't siblings | Power |

### The follow-ups of one prompt

| Tool | Where | What it does | Need | Use |
|---|---|---|---|---|
| Compare | Operations | Follow-ups side by side; get missing replies, make one mainline, delete | Choosing between branches (after Fan out, Variants, forks) | Power |
| ✦ Judge | Compare | One request: a reason for each against your criteria, and a pick. Changes nothing | Best-of-n | Power |
| ✦ Combine | Compare | One reply from the best parts, with sources, as a draft you add as a new follow-up | Merging parallel answers | Rare |

## Views and organizing (people only; nothing is sent)

| Tool | What it does | Use |
|---|---|---|
| Chat view / Editor view | A familiar chat, or the whole tree with the inspector | Core |
| Prompts: All / Context path | Only the line you're on, other branches folded into a note | Common |
| Replies: All / Context path / Selected; Length: Full / Shorten | Which replies are open, and how long | Common |
| Selection / Focus, groups | Which chats are on the page | Power |
| Branch map (panel, or full size with M) | The tree as a git-style graph; click to go | Common |
| Search and filters (Starred, Notes, Left out) | Find prompts and replies across the project | Common |
| Projects, Project files | Group chats; files sent with every chat in a project | Common |
| Import / export | Bring chats in from Claude, or move JSON between installs | Rare |
| Settings › Prompts | Every prompt Treechats sends on your behalf, editable | Rare, but it's what keeps nothing hidden |

## For agents (MCP)

Agents are operators like you: the same tools, carried out by the same code, marked with the agent's name.

| Tool | What it does | Use |
|---|---|---|
| list_projects, list_chats, search, get_context, get_prompt | Read your chats; get_prompt also reports settings, cost, thinking and context changes | Common |
| get_tree | A chat's whole shape: every prompt, branches, versions, merges and marks | Common |
| edit_prompt, fan_out | As in the editor: an edit on a new branch with a reply; one answered branch per option | Power |
| operate, describe | Every other operation by name: star, note, branch, rename_branch, make_mainline, merge, unmerge, reroot, squash, splice, delete, rebase, cherry_pick, model_settings | Power |
| list_saved_prompts | Read your prompt library | Rare |
| spawn, ask, fork | Subagent chats whose context the agent controls exactly; spawn and fork take model settings | Power |
| leave_out, edit_reply, regenerate | Steer what a subagent sees; leave_out takes a stretch (`until`) | Power |
| replay | Re-send after changing context (to the end, or `until` a prompt for a stretch); stops at a prompt that no longer fits, or rewrites it if asked | Power |
| review | A fresh-eyes check of a subagent's reply | Power |
| loop | /loop for a subagent: the same prompt after each reply, up to *times* or *until* a condition is met | Power |
| btw | A side question with the exact context of any prompt in your chats; changes nothing and needs no open page | Common |
| judge, combine | Best-of-n across forks, or across any prompts (as Ctrl/⌘-click picks) | Power |
| distill | Bring back only a brief | Power |

## Observations

- **Where the value is:** the core and common tools are what anyone would expect from a chat app (Edit, Regenerate, Copy,
  Review, Saved prompts). Treechats' own value is in the power tools that shape context: Edit reply, Leave out, Replay,
  Distill, Compare and Judge, plus the stretch tools.
- **Low-use restructuring tools:** Rebase, Cherry-pick, Splice out on one prompt, Reroot, Squash on one prompt, and
  Undo merge come from git, and I expect little use. Candidates to keep in **More** and out of the default bar.
- **Variants overlaps others:** it covers much of what Fan out and Reply to several do. Worth watching whether it earns
  its place.
- **What the stretch tools open up:** with Shift-click in place, Squash and Splice out make more sense as stretch tools
  than single-prompt ones. Replay onto… is most of the way to recipes.
