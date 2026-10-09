/* The command palette (Ctrl/⌘-K). */

/* ---- Command palette ---- */
const palEl=()=>document.getElementById('palette');
let palItems=[], palIdx=0, palReturn=null;
function fuzzy(q, t){
  t=t.toLowerCase(); if(!q) return 1;
  const i=t.indexOf(q); if(i>=0) return 100 - i*.5 - t.length*.01 + (i===0||/\W/.test(t[i-1])?20:0);
  let j=0, score=0, last=-2; for(let k=0;k<t.length && j<q.length;k++) if(t[k]===q[j]){ score += k===last+1 ? 3 : 1; last=k; j++; }
  return j===q.length && score>=q.length*2 ? score : 0;
}
function paletteCommands(q){
  const out=[], add=(group, label, run, kbd)=>out.push({group, label, run, kbd});
  if(sel!=null && S.nodes[sel]){
    const n=S.nodes[sel], g=`Prompt #${sel}`;
    if(n.kind!=='merge') add(g, 'Continue from here', ()=>{ select(sel); setTimeout(()=>{ const t=document.getElementById('contText'); if(t) t.focus(); }, 30); });
    /* operations by group: the ones on the prompt here, the tree ones after the rest of this prompt's commands */
    const opsOf = only => { for(const k of OP_GROUPS.flatMap(([gr])=>Object.keys(OPS).filter(x=>opGroup(x)===gr && (only ? gr==='prompt' : gr!=='prompt')))){ const o=OPS[k]; if(k==='cont' || !available(k,sel)) continue; if(k==='regen' && sampleState!=='ready') continue; add(opGroup(k)==='prompt' ? g : `${g} · ${opGroupLabel(opGroup(k))}`, opLabel(k,sel).replace('…',''), ()=>run(k, sel), opts.opKeys===false?'':kk(o.key)); } };
    opsOf(true);
    add(g, S.fold[sel] ? 'Show the prompts below' : 'Hide the prompts below', ()=>toggleFold(sel));
    if(n.kind!=='merge') add(g, n.star ? 'Unstar' : 'Star', ()=>toggleStar(sel));
    add(g, 'Copy context as a prompt', ()=>copyContextPrompt(sel));
    /* the commands from the input box, so they can be found here too */
    for(const c of COMMANDS) if(!c.root || c.name==='model') add('Commands (type / in the input box)', `/${c.name} · ${c.desc.replace(/\..*$/,'')}`, ()=>{ select(sel); setTimeout(()=>{ const t=document.getElementById('contText'); if(!t) return; if(c.need || c.args){ t.value='/'+c.name+' '; t.dispatchEvent(new Event('input', {bubbles:true})); t.focus(); t.setSelectionRange(t.value.length, t.value.length); } else submitPrompt(composeParent(), '/'+c.name); }, 30); });
    if(sampleState==='ready' && n.kind!=='merge') add(g, AI+'Distill the context into a brief', ()=>openDistill(sel));
    if(n.reply) add(g, 'Edit Claude’s reply', ()=>openReplyEdit(sel));
    add(g, 'Copy this path as Markdown', ()=>copyText(pathMarkdown(sel)));
    add(g, 'Copy this path as messages JSON', ()=>copyText(JSON.stringify(turnsFor(sel,true),null,2)));
    add(g, 'Deselect', ()=>deselect());
    opsOf(false);
    const r=rootOfSel(); if(r) add('Chat', 'Copy the whole chat as Markdown', ()=>copyText(treeMarkdown(r.id)));
  }
  add('App', 'New chat', ()=>document.getElementById('newBtn').click());
  add('App', 'New project', ()=>createSpace());
  add('App', 'Undo', ()=>undo(), IS_MAC?'⌘Z':'Ctrl+Z');
  add('App', 'Redo', ()=>redo(), IS_MAC?'⌘⇧Z':'Ctrl+Shift+Z');
  add('App', opts.simple?'Switch to Editor':'Switch to Chat', ()=>setView(!opts.simple));
  add('App', 'Show all chats', ()=>showAll());
  add('App', 'Import chats', ()=>openImport());
  for(const [f,l] of [['star','starred prompts'],['note','prompts with notes'],['skip','left-out prompts']]) add('Filter', `Show ${l}`, ()=>setFilter(f, true));
  add('App', 'Open the branch map', ()=>openMapView(), 'M');
  add('Project', 'Project files', ()=>openSpaceFiles());
  add('Space', 'Import / export JSON', ()=>openIo());
  add('App', opts.map===false ? 'Show the branch map in the panel' : 'Hide the branch map in the panel', ()=>{ opts.map = opts.map===false; save(); drawMap(); });
  add('App', 'Search prompts and replies', ()=>{ if(narrow()) openDrawer('convs'); else if(opts.collapsed.convs){ opts.collapsed.convs=false; applyLayout(); save(); } setTimeout(()=>{ convFilterEl.focus(); convFilterEl.select(); }, 60); }, '/');
  if(sel!=null && S.nodes[sel] && S.nodes[sel].kind!=='merge') add(`Prompt #${sel}`, 'Comparison grid from here…', ()=>openGridBuilder(sel, ''));
  for(const g of (S.grids||[]).slice(-5).reverse()) if(S.nodes[g.parent]) add('Grids', `Open the grid from #${g.parent}: ${clip(g.rows[0]||'', 40)}`, ()=>openGrid(g.id));
  add('App', 'Scheduled tasks', ()=>openSchedules());
  add('App', 'Schedule a prompt…', ()=>openSchedules(schedFormFor(opts.simple?composeParent():sel, '')));
  add('Settings', 'Open settings', ()=>openSettings());
  if(lockInfo().password) add('App', 'Lock Treechats now', ()=>lockNow());
  if(hasServer()) add('Settings', 'Privacy & security', ()=>openSettings('privacy'));
  add('Settings', 'Keyboard shortcuts', ()=>openSettings('keys'));
  for(const [m,l] of [['system','System'],['light','Light'],['dark','Dark']]) add('Settings', `Theme mode: ${l}`, ()=>{ opts.theme=m; afterSetting('theme'); });
  for(const id of [...Object.keys(PALETTES), ...Object.keys(customThemes())]) add('Settings', `Palette: ${PALETTES[id]?PALETTES[id].name:customThemes()[id].name}`, ()=>{ mput('palette', id, shownMode()); afterSetting('palette'); });
  for(const r of orderedRoots()) add('Go to chat', convTitle(r), ()=>openConv(convKey(r)));
  for(const sid of spaceIds()) if(sid!==DB.current) add('Switch project', DB.spaces[sid].name, ()=>switchSpace(sid));
  const num=q.match(/^#?(\d+)$/);
  if(num && S.nodes[+num[1]] && S.nodes[+num[1]].kind!=='merge'){ const id=+num[1]; out.unshift({group:'Go to prompt', label:`#${id} ${clip(S.nodes[id].text||'',70)}`, run:()=>select(id), score:1000}); }
  if(q.length>=3 && !num) for(const h of searchHits(q).slice(0,6)){ const n=S.nodes[h.id]; out.push({group:'In prompts and replies', label:`#${h.id} ${clip((h.field==='reply'?'Claude: ':'')+(n[h.field]||'').replace(/\s+/g,' '),80)}`, run:()=>select(h.id), score:5}); }
  return out;
}
function renderPalette(){
  const q=document.getElementById('palInput').value.trim().toLowerCase();
  const cmds=paletteCommands(q);
  palItems = q ? cmds.map(c=>({...c, s:c.score ?? fuzzy(q, c.label+' '+c.group)})).filter(c=>c.s>0).sort((a,b)=>b.s-a.s).slice(0,40) : cmds.slice(0,60);
  palIdx=Math.min(palIdx, Math.max(0,palItems.length-1));
  let h='', lastG=null;
  palItems.forEach((c,i)=>{ if(!q && c.group!==lastG){ h+=`<li class="palg" role="presentation">${esc(c.group)}</li>`; lastG=c.group; }
    h+=`<li role="option" id="palo${i}" class="palo ${i===palIdx?'on':''}" aria-selected="${i===palIdx}" data-pal="${i}"><span class="pl">${esc(c.label)}</span>${q?`<span class="pg">${esc(c.group)}</span>`:''}${c.kbd?`<kbd>${c.kbd}</kbd>`:''}</li>`; });
  const ul=document.getElementById('palList');
  ul.innerHTML = h || '<li class="palempty">Nothing matches.</li>';
  document.getElementById('palInput').setAttribute('aria-activedescendant', palItems.length?`palo${palIdx}`:'');
  const on=ul.querySelector('.palo.on'); if(on && on.scrollIntoView) on.scrollIntoView({block:'nearest'});
}
function openPalette(){
  if(!setEl.hidden) closeSettings();
  if(!impEl().hidden) closeImport();
  if(!cmpEl().hidden) closeCompare();
  palReturn=document.activeElement; closeMenu && menuEl && closeMenu();
  const inp=document.getElementById('palInput'); inp.value=''; palIdx=0;
  palEl().hidden=false; renderPalette(); inp.focus({preventScroll:true});
}
function closePalette(refocus=true){ palEl().hidden=true; if(refocus && palReturn && palReturn.focus && document.contains(palReturn)) palReturn.focus({preventScroll:true}); }
function runPalette(i){ const c=palItems[i]; if(!c) return; closePalette(false); c.run(); }
