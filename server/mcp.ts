/* An MCP server at /mcp, so Claude Code (or any MCP client) can use Treechats.

   Reading: list projects and chats, search them, and pull the context of a branch or prompt into a session.
   These never change anything.

   Subagents (Phase 1, see docs/VISION.md): an agent can start chats whose context Treechats owns, continue
   and fork them, leave turns out, correct replies, regenerate, and distill what they found. Agents only ever change
   their own run projects ("Run: <name>"); everything they add is labeled with the agent's name, stays out of your
   Undo, and each run has a cap on model requests. The open Treechats page carries the changes out (server/relay.ts).

   Add it to Claude Code with:

     claude mcp add --transport http --scope user treechats http://localhost:5178/mcp

   Each request gets a fresh server and transport (stateless), reading the latest saved state. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { contextPrompt, ctxChanges, loadState, settingsFor, TreeView, turnsFor, type Tree } from './context.ts';
import { pageOpen, refund, relay, RelayError, spend } from './relay.ts';
import { sampleOnce, type SampleRequest } from './claude.ts';

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
/* where a chat is "at": its checked-out branch, else main, else its first branch */
function convTip(v: TreeView, rootId: number) {
  const bs = v.branches(rootId);
  const b = bs.find((x) => x.head) || bs.find((x) => x.name === 'main') || bs[0];
  if (b) return b.tip;
  let cur = rootId;
  for (;;) { const k = v.all().filter((n) => n.parents[0] === cur && v.visible(n)); if (!k.length) return cur; cur = k[0].id; }
}

type Pick = { project?: string; chat?: string; branch?: string; prompt?: number };
/* the prompt a request means: by number, by branch name, by chat (where it's checked out), else the selection */
function pick(s: State, a: Pick): { error: string } | { sp: State['db']['spaces'][string]; t: Tree; v: TreeView; id: number } {
  const sp = space(s, a.project); if (!sp) return { error: `No project matches "${a.project}".` };
  const t: Tree = sp.tree, v = new TreeView(t);
  let id: number | null = null;
  const conv = conversation(v, a.chat);
  if (a.chat && !conv) return { error: `No chat in ${sp.name} matches "${a.chat}".` };
  if (a.prompt != null) {
    if (!t.nodes[a.prompt]) return { error: `There is no prompt #${a.prompt} in ${sp.name}.` };
    id = a.prompt;
  } else if (a.branch) {
    const bs = v.branches(conv?.id).filter((b) => b.name === a.branch);
    if (!bs.length) return { error: `No branch named "${a.branch}"${conv ? ` in "${v.title(conv)}"` : ` in ${sp.name}`}.` };
    if (bs.length > 1) return { error: `Several chats have a branch named "${a.branch}". Say which chat:\n` + bs.map((b) => `- "${v.title(v.rootOf(b.tip))}"`).join('\n') };
    id = bs[0].tip;
  } else if (conv) id = convTip(v, conv.id);
  else {
    const selId = sp.sel;
    id = selId != null && t.nodes[selId] ? selId : t.head && t.refs[t.head] ? t.refs[t.head].tip : null;
    if (id == null) { const r = v.roots()[0]; if (r) id = convTip(v, r.id); }
  }
  if (id == null) return { error: `${sp.name} has no chats yet.` };
  if (t.nodes[id].kind === 'merge') id = t.nodes[id].parents[0];
  return { sp, t, v, id };
}

type Done = { project: string; chat?: number; prompt?: number; branch?: string; reply?: string; note?: string; brief?: string; replaced?: number; message?: string };
/* what a subagent operation did, as text for the orchestrator */
function report(d: Done, left?: number) {
  const where = [`project "${d.project}"`, d.chat != null ? `chat #${d.chat}` : '', d.prompt != null ? `prompt #${d.prompt}` : '', d.branch ? `branch ${d.branch}` : ''].filter(Boolean).join(', ');
  return [d.message ? `${d.message} (${where})` : where,
    d.note ? `Note: ${d.note}` : '',
    d.reply != null ? `\nReply:\n${d.reply}` : '',
    d.brief != null ? `\nBrief:\n${d.brief}` : '',
    left != null ? `\n(${left} request${left === 1 ? '' : 's'} left in this run)` : ''].filter(Boolean).join('\n');
}

export function buildMcpServer(read: () => State | null) {
  const server = new McpServer(
    { name: 'treechats', version: '0.1.0' },
    { instructions: 'Treechats keeps branching chats with Claude, organised into projects. Reading: use list_chats or search to find a chat, then get_context to bring the context of a branch or prompt into this session. Prompts are numbered (#12) within a project. Subagents: spawn starts a chat in a run project whose context you control exactly; ask continues it, fork tries an alternative from any prompt, leave_out and edit_reply change what it sees from then on, regenerate asks again, replay re-sends a prompt and the ones after it once you have changed the context above them, edit_prompt and fan_out work as in the editor, operate runs every other operation (describe lists them), get_tree shows the shape of a chat, review gets a fresh-eyes second opinion on a reply, loop sends the same prompt again after each reply until a condition is met, btw asks a side question with a chat\'s exact context without changing it, judge picks the best of several forks against your criteria, combine merges them into one reply, distill returns a short brief so only the brief needs to enter your own context. Subagents have no tools: give them the material they need as context. Each run has a request budget.' },
  );
  const withState = <A,>(fn: (s: State, a: A) => ReturnType<typeof text>) => async (a: A) => {
    const s = read();
    return s ? fn(s, a) : fail('Treechats has nothing saved yet. Open it in the browser and start a chat first.');
  };
  const projectArg = z.string().optional().describe('Project name or id. Defaults to the project open in Treechats.');

  server.registerTool('list_projects', { title: 'List projects', description: 'The projects in Treechats, with how many chats each holds. The one open in the app is marked.', inputSchema: {} },
    withState((s) => text(s.db.order.filter((id) => s.db.spaces[id]).map((id) => {
      const sp = s.db.spaces[id], v = new TreeView(sp.tree);
      return `- ${sp.name} (${id})${id === s.db.current ? ' [open]' : ''}: ${v.roots().length} chats`;
    }).join('\n') || 'No projects.')));

  server.registerTool('list_chats', { title: 'List chats', description: 'Chats in a project, newest first, each with its branches and the prompt each branch ends at.', inputSchema: { project: projectArg } },
    withState((s, a: { project?: string }) => {
      const sp = space(s, a.project); if (!sp) return fail(`No project matches "${a.project}".`);
      const v = new TreeView(sp.tree);
      const rs = v.roots().sort((x, y) => v.convKey(y) - v.convKey(x));
      if (!rs.length) return text(`${sp.name} has no chats yet.`);
      return text(`Project: ${sp.name}\n\n` + rs.map((r) => {
        const n = v.all().filter((x) => x.kind !== 'merge' && v.chain(x.id)[0] === r.id).length;
        const bs = v.branches(r.id).map((b) => `${b.name} → #${b.tip}${b.head ? ' (checked out)' : ''}`).join(', ');
        return `- "${v.title(r)}" (starts at #${r.id}, ${n} prompts)\n  branches: ${bs || 'none'}`;
      }).join('\n'));
    }));

  server.registerTool('get_context', {
    title: 'Get context',
    description: 'The context Treechats would send to Claude from a prompt: standing instructions, every earlier prompt and reply on its path, merge notes, minus anything left out. Pick it by prompt number, or by branch name (the branch\'s latest prompt), or by chat (where it is checked out). With nothing given, uses the prompt selected in the app.',
    inputSchema: {
      project: projectArg,
      chat: z.string().optional().describe('Chat title (or part of it), or the number of its first prompt.'),
      branch: z.string().optional().describe('Branch name, such as main.'),
      prompt: z.number().int().optional().describe('Prompt number, such as 12 for #12.'),
      format: z.enum(['prompt', 'messages']).optional().describe('"prompt" (default): one block to read. "messages": the user/assistant turns as JSON.'),
      from: z.number().int().optional().describe('Only the stretch from this prompt down to the chosen one (as Copy as a prompt on a selected stretch), instead of the whole context.'),
    },
  }, withState((s, a: Pick & { format?: 'prompt' | 'messages'; from?: number }) => {
    const r = pick(s, a); if ('error' in r) return fail(r.error);
    const { sp, t, v, id } = r;
    if (a.from != null) {
      const c = v.chain(id), i = c.indexOf(a.from);
      if (i < 0) return fail(`#${a.from} isn't on the line up to #${id}.`);
      const turns = c.slice(i).map((x) => t.nodes[x]).filter((n) => n.kind !== 'merge').flatMap((n) => [{ role: 'user', content: n.text || '' }, ...(n.reply ? [{ role: 'assistant', content: n.reply }] : [])]);
      const body = turns.map((x) => `<${x.role}>\n${x.content}\n</${x.role}>`).join('\n\n');
      const w = `Project "${sp.name}", chat "${v.title(v.rootOf(id))}", #${a.from} to #${id} only`;
      return a.format === 'messages' ? text(w + '\n\n' + JSON.stringify(turns, null, 2)) : text(`(${w})\n\nHere is part of an earlier conversation, for context. Read it, then help with what I ask after it.\n\n<conversation>\n${body}\n</conversation>\n\n`);
    }
    const where = `Project "${sp.name}", chat "${v.title(v.rootOf(id))}", up to prompt #${id}`;
    return a.format === 'messages' ? text(where + '\n\n' + JSON.stringify(turnsFor(s, t, id), null, 2)) : text(`(${where})\n\n` + contextPrompt(s, t, id));
  }));

  server.registerTool('search', { title: 'Search', description: 'Find prompts, replies and notes containing some text, in one project or all of them.', inputSchema: { query: z.string().min(1), project: z.string().optional().describe('Project name or id. Searches every project when left out.') } },
    withState((s, a: { query: string; project?: string }) => {
      const q = a.query.toLowerCase(), sps = a.project ? [space(s, a.project)].filter(Boolean) : s.db.order.map((id) => s.db.spaces[id]).filter(Boolean);
      if (!sps.length) return fail(`No project matches "${a.project}".`);
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
        if (hits.length >= 40) break;
      }
      return text(hits.length ? hits.join('\n') + (hits.length >= 40 ? '\n(Stopped at 40 matches. Narrow the search or name a project.)' : '') : `Nothing matches "${a.query}".`);
    }));

  server.registerTool('get_prompt', { title: 'Get a prompt', description: 'One prompt in full: its text, Claude\'s reply, your note, what it follows, what follows it, and the branches through it.', inputSchema: { prompt: z.number().int(), project: projectArg } },
    withState((s, a: { prompt: number; project?: string }) => {
      const sp = space(s, a.project); if (!sp) return fail(`No project matches "${a.project}".`);
      const t = sp.tree, v = new TreeView(t), n = t.nodes[a.prompt];
      if (!n) return fail(`There is no prompt #${a.prompt} in ${sp.name}.`);
      const kids = v.all().filter((k) => k.parents.includes(n.id) && v.visible(k)).map((k) => '#' + k.id);
      const bs = v.branches().filter((b) => v.chain(b.tip).includes(n.id)).map((b) => b.name);
      return text([
        `#${n.id} in "${v.title(v.rootOf(n.id))}" (${sp.name})${n.skip ? ' · left out of context' : ''}${n.star ? ' · starred' : ''}`,
        `Follows: ${n.parents.map((p) => '#' + p).join(', ') || 'nothing (starts the chat)'} · Followed by: ${kids.join(', ') || 'nothing'} · Branches: ${bs.join(', ') || 'none'}`,
        n.kind === 'merge' ? `Merge of ${n.from || '#' + n.parents[1]} into ${n.into || '#' + n.parents[0]}` : `\nPrompt:\n${n.text}`,
        n.reply ? `\nClaude's reply:\n${n.reply}` : '',
        (() => { const st = settingsFor(t, n.id); const keys = Object.keys(st); return keys.length ? `\nModel settings in effect: ${keys.map((k) => `${k} ${k === 'system' ? JSON.stringify(st[k]) : st[k]}`).join(', ')}` : ''; })(),
        n.usage ? `Usage: ${n.usage.input} tokens in, ${n.usage.output} out${n.usage.cost != null ? `, $${n.usage.cost.toFixed(4)}` : ''}` : '',
        n.thinking ? `\nThe model's thinking (never sent back to it):\n${n.thinking}` : '',
        (() => { const ch = ctxChanges(s, t, n.id); return ch ? `\nContext changed since this reply was written: ${ch.join('; ')}. (For you only; the model never sees this. replay re-sends from here.)` : ''; })(),
        n.note ? `\nNote (never sent to Claude):\n${n.note}` : '',
      ].filter(Boolean).join('\n'));
    }));

  server.registerTool('get_tree', { title: 'Get the shape of a chat', description: 'The whole chat as an outline: every prompt with its number, branches (indented where they split off), which branch ends where, versions, merges, and what is marked (left out, edited, starred, noted, combined, review, settings, context changed). Use it to find where to fork, replay or compare.', inputSchema: { project: projectArg, chat: z.string().optional().describe('Part of the chat title.'), branch: z.string().optional(), prompt: z.number().int().optional().describe('Any prompt in the chat.') } },
    withState((s, a: { project?: string; chat?: string; branch?: string; prompt?: number }) => {
      const r = pick(s, a); if ('error' in r) return fail(r.error);
      const { sp, t, v } = r, root = v.rootOf(r.id), tips = new Map<number, string[]>();
      for (const b of v.branches(root.id)) tips.set(b.tip, [...(tips.get(b.tip) || []), b.name]);
      const trunk = new Set(v.branches(root.id).filter((b) => b.name === 'main').flatMap((b) => v.chain(b.tip)));
      const kidsOf = (id: number) => v.all().filter((k) => k.parents[0] === id && v.visible(k));
      const lines: string[] = []; let count = 0;
      const line = (n: (typeof t.nodes)[string], ind: string) => {
        count++;
        if (n.kind === 'merge') { lines.push(`${ind}#${n.id} ⤵ merge of ${n.from || '#' + n.parents[1]} into ${n.into || '#' + n.parents[0]}`); return; }
        const vs = n.alt != null ? v.all().filter((m) => m.alt === n.alt) : [];
        const marks = [n.reply ? '' : 'no reply', n.skip ? 'left out' : '', n.replyEdited ? 'reply edited' : '', n.star ? '★' : '', n.note ? 'note' : '',
          n.combined ? 'combined' : '', n.reviewOf ? `review of #${n.reviewOf.id}` : '',
          n.set && Object.keys(n.set).length ? 'settings' : '', n.by ? `by ${n.by}` : '',
          vs.length > 1 ? `version ${vs.findIndex((m) => m.id === n.id) + 1}/${vs.length} (others: ${vs.filter((m) => m.id !== n.id).map((m) => '#' + m.id).join(', ')})` : '',
          ctxChanges(s, t, n.id) ? 'context changed' : ''].filter(Boolean);
        const tip = tips.get(n.id);
        lines.push(`${ind}#${n.id} ${(n.text || '').replace(/\s+/g, ' ').slice(0, 90)}${marks.length ? ` [${marks.join(', ')}]` : ''}${tip ? ` ← ${tip.join(', ')}` : ''}`);
      };
      const walk = (id: number, ind: string) => {
        let cur: number | null = id;
        while (cur != null) {
          line(t.nodes[cur], ind);
          const ks = kidsOf(cur), straight = ks.find((k) => trunk.has(k.id)) || ks[0];
          /* the other versions of this prompt, and what follows each, as branches of their own */
          const me = t.nodes[cur];
          if (me.alt != null && v.visible(me)) for (const o of v.all().filter((m) => m.alt === me.alt && m.id !== me.id && !v.visible(m))) { lines.push(`${ind}  (another version of #${cur}:)`); walk(o.id, ind + '  '); }
          for (const k of ks) if (k !== straight) walk(k.id, ind + '  ');
          cur = straight ? straight.id : null;
        }
      };
      walk(root.id, '');
      const bs = v.branches(root.id).map((b) => `${b.name} → #${b.tip}`).join(', ');
      return text(`"${v.title(root)}" in ${sp.name} · ${count} prompts · branches: ${bs || 'none'}\nIndented lines branch off the line above them.\n\n${lines.join('\n')}`);
    }));

  server.registerTool('btw', {
    title: 'Side question',
    description: 'Ask a question with the exact context of a prompt in any of the person\'s chats, and get the answer, without changing anything: nothing is added to the chat (the same as /btw in the page). Use it to ask what a chat decided, what a reply meant, or what to do next, as the model in that chat would answer. One request.',
    inputSchema: {
      project: projectArg,
      chat: z.string().optional().describe('Chat title (or part of it), or the number of its first prompt.'),
      branch: z.string().optional().describe('Branch name, such as main.'),
      prompt: z.number().int().optional().describe('Prompt number, such as 12 for #12. The answer sees everything up to and including its reply.'),
      question: z.string().min(1).describe('The side question.'),
      model: z.enum(['quick', 'default', 'complex']).optional().describe('Which model tier answers (default: default).'),
    },
  }, async (a: Pick & { question: string; model?: 'quick' | 'default' | 'complex' }) => {
    const s = read(); if (!s) return fail('Treechats has nothing saved yet. Open it in the browser and start a chat first.');
    const r = pick(s, a); if ('error' in r) return fail(r.error);
    const { sp, t, v, id } = r;
    const st = settingsFor(t, id) as SampleRequest['settings'];
    const out = await sampleOnce({ input: [...turnsFor(s, t, id), { role: 'user', content: a.question }], modelTier: a.model || 'default', settings: st });
    if (out.error) return fail(`No answer: ${out.error.message || out.error.code}`);
    const cost = out.usage?.cost != null ? ` · $${out.usage.cost.toFixed(4)}` : '';
    return text(`(Side question from project "${sp.name}", chat "${v.title(v.rootOf(id))}", after #${id}. Nothing was added to the chat${cost}.)\n\n${out.text}`);
  });

  server.registerTool('list_saved_prompts', { title: 'List saved prompts', description: "The person's saved prompts in Treechats (their prompt library): name and text. Words in {braces} are placeholders to fill in. Use one as the prompt of spawn, ask or fork.", inputSchema: {} },
    withState((s) => {
      const list = ((s.opts as { saved?: { name: string; text: string }[] } | undefined)?.saved) || [];
      return text(list.length ? list.map((p) => `## ${p.name}\n${p.text}`).join('\n\n') : 'No saved prompts yet.');
    }));

  /* ---- subagents ---- */
  const run = z.string().min(1).max(60).describe('A short name for this piece of work, such as "auth-review". Each run gets its own project ("Run: auth-review"); use the same name to keep working in it.');
  const agent = z.string().max(40).optional().describe('Your name, shown on everything you add. Defaults to "agent".');
  const model = z.enum(['quick', 'default', 'complex']).optional().describe('Which model answers: quick, default or complex. Defaults to the model chosen in Treechats.');
  const promptNo = z.number().int().describe('A prompt number in the run project, as returned by spawn, ask or fork.');
  /* model settings: sent with this prompt and every prompt after it; models that don't use one skip it and say so */
  const bset = {
    system: z.string().optional().describe('A system prompt for this subagent from here on.'),
    thinking: z.boolean().optional().describe('Let the model think before replying (its thinking is kept, folded, and never sent back).'),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('How much effort the model spends (newer models only).'),
    temperature: z.number().min(0).max(1).optional().describe('Sampling temperature (older models only; newer ones skip it).'),
    max_tokens: z.number().int().min(256).max(128000).optional().describe('The longest reply allowed, in tokens.'),
  };
  const act = (op: string, spends: boolean) => async (a: Record<string, unknown>) => {
    let left: number | undefined;
    try {
      if (!pageOpen()) return fail('Treechats isn’t open in a browser. Open it (npm start opens it for you), then try again: agent tools run through the open page for now.');
      if (spends) left = spend(String(a.run));
      const d = await relay(op, a);
      return text(report(d as Done, left));
    } catch (e) {
      if (left != null) refund(String(a.run)); /* nothing was spent on a request that failed */
      return fail(e instanceof RelayError ? e.message : `Treechats couldn’t do that: ${(e as Error).message}`);
    }
  };

  server.registerTool('spawn', {
    title: 'Start a subagent',
    description: 'Start a subagent: a new chat in your run project, with exactly the context you give it, and get its reply. Context can be text you pass (a brief, notes, file contents) and/or the context of an existing Treechats branch or prompt (copied in, the original is not changed). Returns the chat, its first prompt number and the reply.',
    inputSchema: {
      run, agent, model, ...bset,
      prompt: z.string().min(1).describe('What to ask the subagent.'),
      title: z.string().max(80).optional().describe('A title for the subagent chat.'),
      context: z.string().optional().describe('Material the subagent should have before your prompt: a brief, notes, code, file contents.'),
      from: z.object({ project: z.string().optional(), chat: z.string().optional(), branch: z.string().optional(), prompt: z.number().int().optional() }).optional()
        .describe('Copy in the context of an existing Treechats branch or prompt, picked like get_context.'),
    },
  }, async (a) => {
    let ctx = a.context || '';
    if (a.from) {
      const s = read(); if (!s) return fail('Treechats has nothing saved yet.');
      const r = pick(s, a.from); if ('error' in r) return fail(r.error);
      ctx = contextPrompt(s, r.t, r.id) + (ctx ? '\n\n' + ctx : '');
    }
    return act('spawn', true)({ ...a, context: ctx });
  });
  server.registerTool('ask', { title: 'Continue a subagent', description: 'Send a follow-up to a subagent, continuing after a prompt (or at the end of a branch), and get the reply.', inputSchema: { run, agent, model, after: promptNo.optional().describe('Continue after this prompt number.'), branch: z.string().optional().describe('Or continue at the end of this branch.'), prompt: z.string().min(1) } }, act('ask', true));
  server.registerTool('fork', { title: 'Fork a subagent', description: 'Try an alternative: start a new branch after any prompt of a subagent, with a different follow-up and optionally different settings (system prompt, thinking, effort, temperature, max_tokens), and get the reply. The original line is kept.', inputSchema: { run, agent, model, ...bset, at: promptNo.describe('Branch off after this prompt number.'), prompt: z.string().min(1), name: z.string().max(40).optional().describe('A name for the new branch.') } }, act('fork', true));
  server.registerTool('leave_out', { title: 'Leave a turn out', description: 'Stop sending a prompt and its reply to the subagent from the prompts after it (a dead end, a wrong assumption), or include it again. Nothing is deleted.', inputSchema: { run, agent, prompt: promptNo, until: promptNo.optional().describe('Also every prompt down to this one (a stretch of the line).'), left_out: z.boolean().optional().describe('true (default) leaves it out, false includes it again.') } }, act('leave_out', false));
  server.registerTool('edit_reply', { title: 'Correct a reply', description: 'Replace what the subagent said at a prompt. Prompts after it see your version. Marked as edited.', inputSchema: { run, agent, prompt: promptNo, reply: z.string() } }, act('edit_reply', false));
  server.registerTool('regenerate', { title: 'Ask again', description: 'Get a new reply to a subagent prompt, as a new version beside the old one (which is kept), optionally with another model.', inputSchema: { run, agent, model, prompt: promptNo } }, act('regenerate', true));
  server.registerTool('replay', {
    title: 'Replay',
    description: 'After you change a subagent\'s context (leave_out, edit_reply, or an edit above), re-send a prompt and every prompt after it on its branch, one at a time, so their replies are written against the context as it is now. Each becomes a new version (the old ones are kept). By default it stops at a prompt that no longer makes sense after the new replies and tells you why. Costs one request per prompt plus a quick check per prompt after the first. Returns the last reply.',
    inputSchema: {
      run, agent, prompt: promptNo.describe('The first prompt to re-send.'),
      branch: z.string().optional().describe('Follow this branch to its end. Defaults to the branch through the prompt.'),
      until: promptNo.optional().describe('Stop after this prompt instead of going to the end of the branch (replay a stretch).'),
      on_mismatch: z.enum(['stop', 'rewrite', 'ignore']).optional().describe('Before each prompt after the first, a quick check asks whether it still makes sense after the new replies. stop (default): stop there and report why, with a suggested rewrite. rewrite: send the rewrite (marked as rewritten, original kept) and go on. ignore: no checks, send everything as written.'),
      onto: promptNo.optional().describe('Continue under this prompt instead of beside the originals: use it to carry on after a stop.'),
      first_prompt: z.string().optional().describe('Send this text instead of the first prompt (for example your fix after a stop).'),
    },
  }, async (a) => {
    let left: number | undefined, n = 0;
    try {
      if (!pageOpen()) return fail('Treechats isn’t open in a browser. Open it (npm start opens it for you), then try again: agent tools run through the open page for now.');
      n = ((await relay('replay_plan', a)) as { count: number }).count;
      left = spend(String(a.run), n);
      const d = await relay('replay', a) as Done & { requests?: number };
      if (d.requests != null && d.requests < n) { refund(String(a.run), n - d.requests); left += n - d.requests; }
      return text(report(d, left));
    } catch (e) {
      if (left != null) refund(String(a.run), n);
      return fail(e instanceof RelayError ? e.message : `Treechats couldn’t do that: ${(e as Error).message}`);
    }
  });
  server.registerTool('loop', {
    title: 'Loop a prompt',
    description: 'Send the same prompt to a subagent again after each reply, continuing the line: a set number of times, or until a condition is met. With until, a quick check after each reply asks whether the condition is met; its verdict is noted under that reply. Costs one request per send, plus one per check. Returns the last reply. Same as /loop in the page.',
    inputSchema: {
      run, agent, model,
      after: promptNo.optional().describe('Loop from after this prompt number.'), branch: z.string().optional().describe('Or from the end of this branch.'),
      prompt: z.string().min(1).describe('What to send each time, for example "Tighten it further" or "Find another bug and fix it".'),
      times: z.number().int().min(1).max(20).optional().describe('The most times to send it (default 3).'),
      until: z.string().optional().describe('Stop early once this is true of the latest reply, for example "the draft is under 100 words".'),
    },
  }, async (a) => {
    const n = ((a.times as number | undefined) ?? 3) * (a.until ? 2 : 1);
    let left: number | undefined;
    try {
      if (!pageOpen()) return fail('Treechats isn’t open in a browser. Open it (npm start opens it for you), then try again: agent tools run through the open page for now.');
      left = spend(String(a.run), n);
      const d = await relay('loop', a) as Done & { requests?: number };
      if (d.requests != null && d.requests < n) { refund(String(a.run), n - d.requests); left += n - d.requests; }
      return text(report(d, left));
    } catch (e) {
      if (left != null) refund(String(a.run), n);
      return fail(e instanceof RelayError ? e.message : `Treechats couldn’t do that: ${(e as Error).message}`);
    }
  });
  server.registerTool('edit_prompt', {
    title: 'Edit a prompt',
    description: 'Change what was asked at a subagent prompt, as people do: the edit becomes a new version on its own branch and gets a reply. The original keeps its branch and everything after it (use replay with onto to carry those over).',
    inputSchema: { run, agent, model, prompt: promptNo, text: z.string().min(1).describe('The new text of the prompt.') },
  }, act('edit_prompt', true));
  server.registerTool('fan_out', {
    title: 'Fan out',
    description: 'Explore every option a reply offers: one branch per option, each answered. Treechats reads the options from the reply (one quick request) unless you give them. Costs one request per option for the replies. Follow with judge to pick.',
    inputSchema: { run, agent, model, prompt: promptNo.describe('The prompt whose reply offers the options.'), options: z.array(z.object({ title: z.string().optional(), prompt: z.string() })).optional().describe('The follow-ups to send, if you want to choose them yourself.'), replies: z.boolean().optional().describe('Get a reply on each branch. Defaults to true.') },
  }, async (a) => {
    let left: number | undefined, spent = 0;
    try {
      if (!pageOpen()) return fail('Treechats isn’t open in a browser. Open it (npm start opens it for you), then try again: agent tools run through the open page for now.');
      if (!a.options?.length) { left = spend(String(a.run), 1); spent++; }
      const plan = await relay('fan_plan', a) as { options: { title: string; prompt: string }[]; read: boolean };
      if (spent && !plan.read) { refund(String(a.run), 1); spent--; left = (left ?? 0) + 1; }
      if (a.replies !== false) { left = spend(String(a.run), plan.options.length); spent += plan.options.length; }
      const d = await relay('fan_out', { ...a, options: plan.options });
      return text(report(d as Done, left));
    } catch (e) {
      if (spent) refund(String(a.run), spent);
      return fail(e instanceof RelayError ? e.message : `Treechats couldn’t do that: ${(e as Error).message}`);
    }
  });
  const OPS: Record<string, string> = {
    star: 'prompt; value (false to unstar)',
    note: 'prompt; text; append (true adds to the note); value: false clears. Notes are never sent to the model: a scratchpad for you',
    branch: 'prompt; name. Start a branch at a prompt',
    rename_branch: 'branch (current name); name',
    make_mainline: 'prompt. The line through it becomes main',
    merge: 'prompt (the tip of the branch to bring in); onto (the prompt to merge into). Adds a merge point after onto',
    unmerge: 'prompt (a merge point)',
    reroot: 'prompt; text (optional summary to start from). Cuts the prompt from what came before',
    squash: 'prompt (first); until (last). Collapses the stretch into one prompt and reply',
    splice: 'prompt; until (optional last). Removes the stretch; what followed attaches above it',
    delete: 'prompt. Deletes it and everything after it',
    rebase: 'prompt; onto. Moves it and what follows under another prompt',
    cherry_pick: 'prompt; onto. Copies its text under another prompt, without a reply',
    rename_chat: 'prompt (any prompt in the chat); name (the new title)',
    model_settings: 'prompt; system, thinking, effort, temperature, max_tokens (any of them); value: false clears. Applies from that prompt on',
  };
  server.registerTool('describe', { title: 'Describe operations', description: 'The operations operate can run, with the arguments each takes.', inputSchema: { op: z.string().optional() } },
    async (a) => text(a.op ? (OPS[a.op] ? `${a.op}: ${OPS[a.op]}` : `Unknown operation "${a.op}". Known: ${Object.keys(OPS).join(', ')}`) : 'Run these with operate. Every call needs run (and agent, for labels); none of them sends a request.\n\n' + Object.entries(OPS).map(([k, v]) => `- ${k}: ${v}`).join('\n')));
  server.registerTool('operate', {
    title: 'Run an operation',
    description: 'Restructure or mark a subagent chat in your run, the way people do in the editor: star, note, branch, rename_branch, make_mainline, merge, unmerge, reroot, squash, splice, delete, rebase, cherry_pick, model_settings, rename_chat. Call describe for the arguments. No requests are sent; changes stay out of the person’s Undo.',
    inputSchema: {
      run, agent, ...bset,
      op: z.enum(['star', 'note', 'branch', 'rename_branch', 'make_mainline', 'merge', 'unmerge', 'reroot', 'squash', 'splice', 'delete', 'rebase', 'cherry_pick', 'model_settings', 'rename_chat']),
      prompt: z.number().int().optional(), until: z.number().int().optional(), onto: z.number().int().optional(),
      branch: z.string().optional(), name: z.string().max(80).optional(), text: z.string().optional(), value: z.boolean().optional(), append: z.boolean().optional(),
    },
  }, act('operate', false));
  server.registerTool('review', {
    title: 'Get a second opinion',
    description: 'A fresh-eyes review of a subagent reply: a new chat in your run that sees only that prompt and reply (or the whole conversation up to it), asked to point out what is wrong, missing or weak. A reviewer that did not write the answer has no reason to defend it. One request. Returns the review.',
    inputSchema: { run, agent, model, prompt: promptNo.describe('The prompt whose reply to review.'), include_conversation: z.boolean().optional().describe('Also show the reviewer the conversation up to it. Defaults to false.'), instructions: z.string().optional().describe('What to ask the reviewer; {material} becomes what it sees. Defaults to the review prompt in Treechats.') },
  }, act('review', true));
  server.registerTool('judge', {
    title: 'Judge follow-ups',
    description: 'Best-of-n: Claude reads the context up to a prompt and each follow-up with its reply (all of them, or the ones you name), gives a reason for each against your criteria, and picks one. One request. Nothing is changed; continue on the pick yourself (ask after it).',
    inputSchema: { run, agent, after: promptNo.optional().describe('The prompt the alternatives follow (or give prompts from anywhere, and their shared context is used)'), prompts: z.array(z.number().int()).optional().describe('These prompts: follow-ups of after, or any prompts (as Ctrl/⌘-click picks). Defaults to every follow-up of after.'), criteria: z.string().optional().describe('What to judge by, such as "correct, then shortest".') },
  }, act('judge', true));
  server.registerTool('combine', {
    title: 'Combine follow-ups',
    description: 'Claude writes one reply from the best parts of the follow-ups to a prompt, with the follow-up message it answers and which parts came from where. One request. It is added as a new follow-up marked as combined, on its own branch; the originals are kept.',
    inputSchema: { run, agent, after: promptNo.optional().describe('The prompt the alternatives follow (or give prompts from anywhere, and their shared context is used)'), prompts: z.array(z.number().int()).optional().describe('These prompts: follow-ups of after, or any prompts that share context. Defaults to every follow-up of after.'), instructions: z.string().optional().describe('How to combine them.') },
  }, act('combine', true));
  server.registerTool('distill', { title: 'Distill a subagent', description: 'Have Claude write a short brief (goal, decisions, facts, open questions) of a subagent chat up to a prompt, so only the brief needs to enter your own context.', inputSchema: { run, agent, prompt: promptNo.optional(), branch: z.string().optional(), save_as_note: z.boolean().optional().describe('Also keep the brief as a note on that prompt.') } }, act('distill', true));

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
