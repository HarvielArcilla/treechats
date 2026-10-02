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
- MCP server: let Claude Code and other tools read a conversation tree, branch it, and add prompts
- Editor panel (VS Code webview)

## Ideas waiting their turn
- "Written before this changed" marker after editing an earlier prompt
- In Compare: "Ask which is best" and "Combine into one"
- Instructions per conversation
- Export a branch as a standalone page
- Select several prompts to delete, leave out or copy at once
- Automatic conversation titles (first pass exists under Settings › Naming)
