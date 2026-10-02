/* An MCP server at /mcp, so Claude Code (or any MCP client) can read your Treechats: list spaces and conversations,
   search them, and pull the context of a branch or prompt into a session. It only reads; nothing here changes your
   tree. Add it to Claude Code with:

     claude mcp add --transport http --scope user treechats http://localhost:5178/mcp

   Each request gets a fresh server and transport (stateless), reading the latest saved state. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { contextPrompt, loadState, TreeView, turnsFor, type Tree } from './context.ts';

type State = NonNullable<ReturnType<typeof loadState>>;
const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const one = (s: string) => s.replace(/\s+/g, ' ').trim();

function space(state: State, name?: string) {
  const db = state.db;
  if (!name) return db.spaces[db.current] || db.spaces[db.order[0]];
  const low = name.trim().toLowerCase();
  return db.spaces[name] || Object.values(db.spaces).find((s) => s.name.toLowerCase() === low)
    || Object.values(db.spaces).find((s) => s.name.toLowerCase().includes(low));
}
function conversation(v: TreeView, q?: string | number) {
  if (q == null || q === '') return null;
  const rs = v.roots();
  if (typeof q === 'number' || /^#?\d+$/.test(String(q))) { const id = Number(String(q).replace('#', '')); return rs.find((r) => r.id === id) || (v.node(id) ? v.rootOf(id) : null); }
  const low = String(q).toLowerCase();
  return rs.find((r) => v.title(r).toLowerCase() === low) || rs.find((r) => v.title(r).toLowerCase().includes(low)) || null;
}
/* where a conversation is "at": its checked-out branch, else main, else its first branch */
function convTip(v: TreeView, rootId: number) {
  const bs = v.branches(rootId);
  const b = bs.find((x) => x.head) || bs.find((x) => x.name === 'main') || bs[0];
  if (b) return b.tip;
  let cur = rootId;
  for (;;) { const k = v.all().filter((n) => n.parents[0] === cur && v.visible(n)); if (!k.length) return cur; cur = k[0].id; }
}

export function buildMcpServer(read: () => State | null) {
  const server = new McpServer(
    { name: 'treechats', version: '0.1.0' },
    { instructions: 'Treechats keeps branching conversations with Claude, organised into spaces. Use list_conversations or search to find one, then get_context to bring the context of a branch or prompt into this session. Prompts are numbered (#12) within a space. These tools only read.' },
  );
  const withState = <A,>(fn: (s: State, a: A) => ReturnType<typeof text>) => async (a: A) => {
    const s = read();
    return s ? fn(s, a) : fail('Treechats has nothing saved yet. Open it in the browser and start a conversation first.');
  };
  const spaceArg = z.string().optional().describe('Space name or id. Defaults to the space open in Treechats.');

  server.registerTool('list_spaces', { title: 'List spaces', description: 'The spaces in Treechats, with how many conversations each holds. The one open in the app is marked.', inputSchema: {} },
    withState((s) => text(s.db.order.filter((id) => s.db.spaces[id]).map((id) => {
      const sp = s.db.spaces[id], v = new TreeView(sp.tree);
      return `- ${sp.name} (${id})${id === s.db.current ? ' [open]' : ''}: ${v.roots().length} conversations`;
    }).join('\n') || 'No spaces.')));

  server.registerTool('list_conversations', { title: 'List conversations', description: 'Conversations in a space, newest first, each with its branches and the prompt each branch ends at.', inputSchema: { space: spaceArg } },
    withState((s, a: { space?: string }) => {
      const sp = space(s, a.space); if (!sp) return fail(`No space matches "${a.space}".`);
      const v = new TreeView(sp.tree);
      const rs = v.roots().sort((x, y) => v.convKey(y) - v.convKey(x));
      if (!rs.length) return text(`${sp.name} has no conversations yet.`);
      return text(`Space: ${sp.name}\n\n` + rs.map((r) => {
        const n = v.all().filter((x) => x.kind !== 'merge' && v.chain(x.id)[0] === r.id).length;
        const bs = v.branches(r.id).map((b) => `${b.name} → #${b.tip}${b.head ? ' (checked out)' : ''}`).join(', ');
        return `- "${v.title(r)}" (starts at #${r.id}, ${n} prompts)\n  branches: ${bs || 'none'}`;
      }).join('\n'));
    }));

  server.registerTool('get_context', {
    title: 'Get context',
    description: 'The context Treechats would send to Claude from a prompt: standing instructions, every earlier prompt and reply on its path, merge notes, minus anything left out. Pick it by prompt number, or by branch name (the branch\'s latest prompt), or by conversation (where it is checked out). With nothing given, uses the prompt selected in the app.',
    inputSchema: {
      space: spaceArg,
      conversation: z.string().optional().describe('Conversation title (or part of it), or the number of its first prompt.'),
      branch: z.string().optional().describe('Branch name, such as main.'),
      prompt: z.number().int().optional().describe('Prompt number, such as 12 for #12.'),
      format: z.enum(['prompt', 'messages']).optional().describe('"prompt" (default): one block to read. "messages": the user/assistant turns as JSON.'),
    },
  }, withState((s, a: { space?: string; conversation?: string; branch?: string; prompt?: number; format?: 'prompt' | 'messages' }) => {
    const sp = space(s, a.space); if (!sp) return fail(`No space matches "${a.space}".`);
    const t: Tree = sp.tree, v = new TreeView(t);
    let id: number | null = null;
    const conv = conversation(v, a.conversation);
    if (a.conversation && !conv) return fail(`No conversation in ${sp.name} matches "${a.conversation}".`);
    if (a.prompt != null) {
      if (!t.nodes[a.prompt]) return fail(`There is no prompt #${a.prompt} in ${sp.name}.`);
      id = a.prompt;
    } else if (a.branch) {
      const bs = v.branches(conv?.id).filter((b) => b.name === a.branch);
      if (!bs.length) return fail(`No branch named "${a.branch}"${conv ? ` in "${v.title(conv)}"` : ` in ${sp.name}`}.`);
      if (bs.length > 1) return fail(`Several conversations have a branch named "${a.branch}". Say which conversation:\n` + bs.map((b) => `- "${v.title(v.rootOf(b.tip))}"`).join('\n'));
      id = bs[0].tip;
    } else if (conv) id = convTip(v, conv.id);
    else {
      const selId = sp.sel;
      id = selId != null && t.nodes[selId] ? selId : t.head && t.refs[t.head] ? t.refs[t.head].tip : null;
      if (id == null) { const r = v.roots()[0]; if (r) id = convTip(v, r.id); }
    }
    if (id == null) return fail(`${sp.name} has no conversations yet.`);
    if (t.nodes[id].kind === 'merge') id = t.nodes[id].parents[0];
    const where = `Space "${sp.name}", conversation "${v.title(v.rootOf(id))}", up to prompt #${id}`;
    return a.format === 'messages' ? text(where + '\n\n' + JSON.stringify(turnsFor(s, t, id), null, 2)) : text(`(${where})\n\n` + contextPrompt(s, t, id));
  }));

  server.registerTool('search', { title: 'Search', description: 'Find prompts, replies and notes containing some text, in one space or all of them.', inputSchema: { query: z.string().min(1), space: z.string().optional().describe('Space name or id. Searches every space when left out.') } },
    withState((s, a: { query: string; space?: string }) => {
      const q = a.query.toLowerCase(), sps = a.space ? [space(s, a.space)].filter(Boolean) : s.db.order.map((id) => s.db.spaces[id]).filter(Boolean);
      if (!sps.length) return fail(`No space matches "${a.space}".`);
      const hits: string[] = [];
      for (const sp of sps) {
        const v = new TreeView(sp!.tree);
        for (const n of v.all()) {
          if (n.kind === 'merge' || !v.visible(n)) continue;
          const fields: [string, string | undefined][] = [['prompt', n.text], ['reply', n.reply], ['note', n.note]];
          for (const [f, val] of fields) {
            const i = val ? val.toLowerCase().indexOf(q) : -1; if (i < 0) continue;
            hits.push(`- ${sp!.name} · "${clip(v.title(v.rootOf(n.id)), 50)}" · #${n.id} (${f}): …${one(val!.slice(Math.max(0, i - 60), i + q.length + 80))}…`);
            break;
          }
          if (hits.length >= 40) break;
        }
      }
      return text(hits.length ? hits.join('\n') : `Nothing matches "${a.query}".`);
    }));

  server.registerTool('get_prompt', { title: 'Get a prompt', description: 'One prompt in full: its text, Claude\'s reply, your note, what it follows, what follows it, and the branches through it.', inputSchema: { prompt: z.number().int(), space: spaceArg } },
    withState((s, a: { prompt: number; space?: string }) => {
      const sp = space(s, a.space); if (!sp) return fail(`No space matches "${a.space}".`);
      const t = sp.tree, v = new TreeView(t), n = t.nodes[a.prompt];
      if (!n) return fail(`There is no prompt #${a.prompt} in ${sp.name}.`);
      const kids = v.all().filter((k) => k.parents.includes(n.id) && v.visible(k)).map((k) => '#' + k.id);
      const bs = v.branches().filter((b) => v.chain(b.tip).includes(n.id)).map((b) => b.name);
      return text([
        `#${n.id} in "${v.title(v.rootOf(n.id))}" (${sp.name})${n.skip ? ' · left out of context' : ''}${n.star ? ' · starred' : ''}`,
        `Follows: ${n.parents.map((p) => '#' + p).join(', ') || 'nothing (starts the conversation)'} · Followed by: ${kids.join(', ') || 'nothing'} · Branches: ${bs.join(', ') || 'none'}`,
        n.kind === 'merge' ? `Merge of ${n.from || '#' + n.parents[1]} into ${n.into || '#' + n.parents[0]}` : `\nPrompt:\n${n.text}`,
        n.reply ? `\nClaude's reply:\n${n.reply}` : '',
        n.note ? `\nNote (never sent to Claude):\n${n.note}` : '',
      ].filter(Boolean).join('\n'));
    }));

  return server;
}

/* one request in, one response out */
export async function handleMcp(req: Request, read: () => State | null): Promise<Response> {
  const server = buildMcpServer(read);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(req); }
  finally { setTimeout(() => { transport.close().catch(() => {}); server.close().catch(() => {}); }, 0); }
}
