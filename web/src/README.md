# The page's script

The page (`web/index.html`) is drawn by the files here. They are **one script split by topic**: `scripts/app-script.ts`
joins them, in the order [`ORDER`](ORDER) lists, into `/app.js`, which the page loads with a plain `<script>`.

- **No imports.** A name declared at the top of any file (a function, a `const`, a `let`) is visible in all of them,
  as in a single `<script>`. To find where something is defined, search for `function name(` or `const name`.
- **Order matters only for what runs while the page loads.** Functions are hoisted, so they can live in any file.
  A top-level `const` or `let`, and any statement that runs immediately (an event listener being added, the start-up
  at the end of `startup.js`), runs in the order of `ORDER`, so something used while the page loads must be declared
  in an earlier file.
- **Errors point at these files.** `app.js` comes with a source map, so the browser's console and debugger show
  `src/replies.js:42`, not a line of the joined script.
- **Development:** `npm run dev` joins them on each request and reloads the page when you save a file.

Shared with the server, in `web/public` (loaded before this script, as plain scripts the server also imports):
`sendmodes.js` (Include as), `treecore.js` (the tree and what a prompt sends), `docsync.js` (syncing the document with
the server) and `treeops.js` (tree operations and the ✦ tools). The styles are in `web/styles`.

## Where to start reading

| To understand | Read |
|---|---|
| What the page holds | `state.js` (the tree on screen `S`, the selection, your settings `opts`), then `storage.js` (projects, loading, saving) |
| How it stays in step with the server | `sync.js`, `server-events.js`, and `web/public/docsync.js` |
| How a change is made and undone | `history.js` (`commit`, undo), then `operations.js` (each operation, with its change in `treeops.js`) |
| What a prompt sends | `context.js`, and `web/public/treecore.js` |
| How replies are asked for and shown | `replies.js` (the server writes them: `server/replies.ts`) |
| How the page is drawn | `render.js`, `rows.js` (Editor), `chat.js` (Chat view), `inspector.js` |
| The input box | `input.js` (sending, / commands), `prompts.js` (the wording Treechats sends) |
| Clicks and keys | `ui-events.js`, `drag.js`, `navigation.js` |
| One feature | its own file: `replay.js`, `fanout.js`, `compare.js`, `judge.js`, `review.js`, `distill.js`, `grid.js`, `variants.js`, `includeas.js`, `excerpt.js`, `schedules.js`, `map.js`, `import.js`, `folders.js`, `changes.js`, `themes.js`, `settings.js`… |

Each file starts with a line saying what it covers.

## Adding a file

Create it here, add its name to `ORDER` (after anything its top-level code needs while the page loads), and start it
with a comment saying what it's for.
