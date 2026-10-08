/* Treechats document sync: how the saved document is split into units, compared and changed, the same way in the
   page and on the server.

   The server owns the document ({db, opts}: every project, chat, prompt and setting). Writers (the page, agents,
   scheduled tasks) send changes as ops on small units, not the whole document, so changes to different units never
   overwrite each other:

   - opts.<key>                              a setting
   - db.<key>                                order, current project, the project counter
   - db.spaces.<sid>                         a project exists (a container: creating it never overwrites it)
   - db.spaces.<sid>.<key>                   a project's name, selection and so on
   - db.spaces.<sid>.tree                    its tree exists (container)
   - db.spaces.<sid>.tree.<key>              counters, the checked-out branch, project files, views…
   - db.spaces.<sid>.tree.<map>              nodes, refs, convs, active, fold exist (containers)
   - db.spaces.<sid>.tree.<map>.<key>        one prompt, one branch, one chat's details…

   An op is {p: path, v: value} to set a unit, or {p: path, d: 1} to delete it. Counters (the next prompt number and
   so on) only grow: applying one takes the larger value. Loaded by the page as a plain script and imported by the
   server; it sets globalThis.TreechatsDoc. */
(function(){
  const MAPS = ['nodes', 'refs', 'convs', 'active', 'fold'];
  const COUNTERS = { db:['nextSpace'], tree:['nextId', 'nextRef', 'tsFrom', 'tsDone'] };
  const key = p => JSON.stringify(p);
  const isContainer = p => (p.length === 3 && p[0] === 'db' && p[1] === 'spaces') || (p.length === 4 && p[3] === 'tree') || (p.length === 5 && p[3] === 'tree' && MAPS.includes(p[4]));
  const isCounter = p => (p.length === 2 && p[0] === 'db' && COUNTERS.db.includes(p[1])) || (p.length === 5 && p[3] === 'tree' && COUNTERS.tree.includes(p[4]));
  /* a prompt (node) unit, and which project and prompt number it is */
  const nodeOf = p => p.length === 6 && p[3] === 'tree' && p[4] === 'nodes' ? {sid:p[2], id:+p[5]} : null;
  const refOf = p => p.length === 6 && p[3] === 'tree' && p[4] === 'refs' ? {sid:p[2], rid:p[5]} : null;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* every unit of a document (or only of some projects), as path key → JSON */
  function units(doc, sids){
    const out = new Map(), put = (p, v) => out.set(key(p), v === undefined ? undefined : JSON.stringify(v));
    const db = doc.db || {}, opts = doc.opts || {};
    if(!sids){
      for(const k of Object.keys(opts)) put(['opts', k], opts[k]);
      for(const k of Object.keys(db)) if(k !== 'spaces') put(['db', k], db[k]);
    }
    for(const sid of Object.keys(db.spaces || {})){
      if(sids && !sids.includes(sid)) continue;
      const sp = db.spaces[sid]; if(!sp || typeof sp !== 'object') continue;
      put(['db', 'spaces', sid], {});
      for(const k of Object.keys(sp)) if(k !== 'tree') put(['db', 'spaces', sid, k], sp[k]);
      const t = sp.tree; if(!t || typeof t !== 'object') continue;
      put(['db', 'spaces', sid, 'tree'], {});
      for(const k of Object.keys(t)){
        if(MAPS.includes(k) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])){
          put(['db', 'spaces', sid, 'tree', k], {});
          for(const e of Object.keys(t[k])) put(['db', 'spaces', sid, 'tree', k, e], t[k][e]);
        } else put(['db', 'spaces', sid, 'tree', k], t[k]);
      }
    }
    return out;
  }
  /* the ops that turn base into cur (both from units()); scope: only units under these projects (and none of opts/db)
     when both maps were made with the same sids */
  function diff(base, cur){
    const ops = [];
    for(const [k, v] of cur) if(base.get(k) !== v) ops.push(v === undefined ? {p:JSON.parse(k), d:1} : {p:JSON.parse(k), v:JSON.parse(v)});
    for(const k of base.keys()) if(!cur.has(k)) ops.push({p:JSON.parse(k), d:1});
    return ops;
  }
  /* apply ops to a document in place; returns the projects they touched */
  function apply(doc, ops){
    const touched = new Set();
    /* sets first (containers before what's in them), then deletes from the deepest up */
    const sets = ops.filter(o => !o.d).sort((a, b) => a.p.length - b.p.length), dels = ops.filter(o => o.d).sort((a, b) => b.p.length - a.p.length);
    for(const o of sets){
      /* nothing is written into a project that no longer exists (one deleted while an agent was writing to it) */
      if(o.p[0] === 'db' && o.p[1] === 'spaces' && o.p.length > 3 && !(doc.db && doc.db.spaces && doc.db.spaces[o.p[2]])) continue;
      const parent = walk(doc, o.p.slice(0, -1), true), k = o.p[o.p.length - 1];
      if(!parent) continue;
      if(o.p[1] === 'spaces' && o.p.length >= 3) touched.add(o.p[2]);
      if(isContainer(o.p)){ if(!parent[k] || typeof parent[k] !== 'object') parent[k] = Array.isArray(o.v) ? [] : {}; continue; }
      if(isCounter(o.p) && typeof parent[k] === 'number' && typeof o.v === 'number'){ parent[k] = Math.max(parent[k], o.v); continue; }
      parent[k] = clone(o.v);
    }
    for(const o of dels){
      const parent = walk(doc, o.p.slice(0, -1), false), k = o.p[o.p.length - 1];
      if(o.p[1] === 'spaces' && o.p.length >= 3) touched.add(o.p[2]);
      if(parent && own(parent, k)) delete parent[k];
    }
    return touched;
  }
  function walk(doc, p, make){
    let o = doc;
    for(const k of p){
      if(!o || typeof o !== 'object') return null;
      if(!own(o, k) || o[k] == null || typeof o[k] !== 'object'){ if(!make) return null; o[k] = {}; }
      o = o[k];
    }
    return o;
  }
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  /* the value of a unit in a document (undefined if absent) */
  function get(doc, p){ const parent = walk(doc, p.slice(0, -1), false); return parent && own(parent, p[p.length - 1]) ? parent[p[p.length - 1]] : undefined; }

  /* Give a prompt a new number in one tree, with everything that points at it: parents, version groups, the active
     version, branch tips, chat details and folds. Used when two writers made the same new prompt number at once:
     the one not yet saved moves to the next free number. */
  function renumberNode(t, from, to){
    if(!t.nodes[from] || t.nodes[to]) return false;
    const n = t.nodes[from]; delete t.nodes[from]; n.id = to; t.nodes[to] = n;
    for(const m of Object.values(t.nodes)){
      if(Array.isArray(m.parents)) m.parents = m.parents.map(p => p === from ? to : p);
      if(m.alt === from) m.alt = to;
      if(m.reviewOf && m.reviewOf.id === from) m.reviewOf.id = to;
      if(m.combined && Array.isArray(m.combined.from)) m.combined.from = m.combined.from.map(p => p === from ? to : p);
    }
    for(const r of Object.values(t.refs || {})) if(r.tip === from) r.tip = to;
    if(t.active){ for(const [g, v] of Object.entries(t.active)) if(v === from) t.active[g] = to; if(own(t.active, from)){ t.active[to] = t.active[from]; delete t.active[from]; } }
    for(const m of ['convs', 'fold']) if(t[m] && own(t[m], from)){ t[m][to] = t[m][from]; delete t[m][from]; }
    for(const c of Object.values(t.convs || {})) if(c && c.sel === from) c.sel = to;
    if(Array.isArray(t.convOrder)) t.convOrder = t.convOrder.map(k => k === from ? to : k);
    t.nextId = Math.max(t.nextId || 1, to + 1);
    return true;
  }
  function renumberRef(t, from, to){
    if(!t.refs || !t.refs[from] || t.refs[to]) return false;
    t.refs[to] = t.refs[from]; delete t.refs[from];
    if(t.head === from) t.head = to;
    const n = +String(to).slice(1); if(Number.isFinite(n)) t.nextRef = Math.max(t.nextRef || 1, n + 1);
    return true;
  }

  globalThis.TreechatsDoc = { MAPS, key, isContainer, isCounter, nodeOf, refOf, units, diff, apply, get, clone, renumberNode, renumberRef };
})();
