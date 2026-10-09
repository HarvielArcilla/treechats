/* Drawing the page: the tree or thread, the lists, the cards on the right, and redrawing parts of them. */

function renderTree(){
  if(slash) queueMicrotask(()=>{ if(slash && !document.contains(slash.box)) closeSlash(); });
  const pathSet=new Set(sel!=null&&S.nodes[sel]?path(sel):[]);
  for(const x of pathSet) if(x!==sel && S.fold[x]) delete S.fold[x];
  trunk = new Set(Object.values(S.refs).filter(r=>r.name==='main' && S.nodes[r.tip]).flatMap(r=>chain(r.tip)));
  let h='';
  if(pick && pick.op==='also') h+=`<div class="pickBanner" data-key="pick"><span>Reply to several: tap the prompts to reply to · <b>${alsoTargets.size+1} picked</b></span><button class="btn" data-cancel>Done <kbd style="color:inherit;border-color:currentColor">Esc</kbd></button></div>`;
  else if(pick && pick.op==='replayonto') h+=`<div class="pickBanner" data-key="pick"><span>${AI}Replay #${pick.line[0]}${pick.line.length>1?'–#'+pick.line[pick.line.length-1]:''} onto: choose the prompt to continue from</span><button class="btn" data-cancel>Cancel <kbd style="color:inherit;border-color:currentColor">Esc</kbd></button></div>`;
  else if(pick){ const o=OPS[pick.op], who=refsAt(pick.src).map(refName)[0]; h+=`<div class="pickBanner" data-key="pick"><span>${o.label.replace('…','')} ${who?esc(who)+' (#'+pick.src+')':'#'+pick.src}: ${o.pick}</span><button class="btn" data-cancel>Cancel <kbd style="color:inherit;border-color:currentColor">Esc</kbd></button></div>`; }
  if(range && !pick && !opts.simple) h+=rangeBarHTML();
  else if(alsoTargets.size && !pick && !opts.simple && sel!=null) h+=pickedBarHTML();
  const rs=orderedRoots(), shown=rs.filter(r=>!isHidden(r)), composing=composeFor==='root' || !rs.length;
  const simpleNow = opts.simple && !pick && composeFor!=='root' && rs.length;
  if(simpleNow ? rs.length : shown.length){ const rm=repliesMode(), rl=lenMode();
    const lineGroup=`<div class="vgroup" role="group" aria-label="Which prompts"><span>Prompts</span>${[['all','All','Every branch of each chat'],['line','Context path','Only the line you\u2019re on: what the selected prompt sends, and the prompts after it. Other branches fold into a note where they split off']].map(([v,l,t])=>`<button class="seg" data-linemode="${v}" aria-pressed="${(v==='line')===!!opts.lineOnly}" title="${t}">${l}</button>`).join('')}</div>`;
    const showGroup=`<div class="vgroup" role="group" aria-label="Which replies"><span>Replies</span>${[['all','All','Every reply'],['path','Context path','Replies the selected prompt sends'],['selected','Selected','Only the selected prompt\u2019s reply']].map(([v,l,t])=>`<button class="seg" data-rmode="${v}" aria-pressed="${rm===v}" title="${t}">${l}</button>`).join('')}</div>`;
    const lenGroup=lenGroupHTML(rl);
    if(!simpleNow && !(opts.simple && !pick && composing)) h+=`<div class="viewbar" data-key="viewbar">${lineGroup}${showGroup}${lenGroup}</div>`; }
  /* the composer is keyed as the conversation it will become, so sending turns it into that conversation in place */
  if(simpleNow) h+=simpleHTML();
  /* Chat view, starting a chat: a page of its own, like a new chat in any chat app, not the tree */
  else if(opts.simple && !pick && composing) h+=newChatHTML(rs.length);
  else {
  if(composing) h+=`<section class="conv" data-key="cv${S.nextId}">${rs.length?'<p class="emptyhead">New chat</p>':`<p class="emptyhead">Start a chat in ${esc(DB.spaces[DB.current].name)}</p><p class="note" style="margin-bottom:10px">You can also move a chat here from another project with its Move button.</p>`}${composerHTML('root')}</section>`;
  const offN=rs.length-shown.length;
  if(!shown.length && rs.length && !composing) h+=`<div class="empty" data-key="offnote">All ${rs.length} chats in this project are hidden. Choose which to show from the chat list, or <button class="linkbtn" data-showall style="color:var(--accent)">show them all</button>.</div>`;
  /* Prompts: Context path: in the selected prompt's chat, only the line it's on (with whatever merges bring in) */
  /* what the selected prompt sends (its context path, merges included), then the line after it. A branch merged in
     further down isn't part of the selected prompt's context yet, so it folds into a note at the merge */
  const lineSet = opts.lineOnly && sel!=null && S.nodes[sel] ? (()=>{ const c=chain(threadTip(sel)), i=c.indexOf(sel); return new Set([...path(sel), ...(i<0 ? [] : c.slice(i))]); })() : null, lineRoot = lineSet ? chain(sel)[0] : null;
  /* chats off screen are drawn lazily at an estimated height; carry each one's real height over from the last draw,
     or the chats above you change size on every redraw and the page jumps */
  const knownH=new Map(); for(const sec of treeEl.querySelectorAll('section.conv[data-key]')){ const cs=getComputedStyle(sec), box=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth), h=sec.getBoundingClientRect().height-box; if(h>0) knownH.set(sec.dataset.key, Math.round(h)); }
  for(const r of shown){
    curLine = r.id===lineRoot ? lineSet : null;
    const size=[...desc(r.id)].filter(x=>S.nodes[x].kind!=='merge').length+1, k=convKey(r);
    const est=knownH.get('cv'+k) ?? (60+size*44+(repliesMode()==='all'?size*140:0));
    h+=`<section class="conv" data-conv="${r.id}" data-key="cv${k}" style="contain-intrinsic-size:auto ${est}px"><div class="convHead" draggable="true" data-convdrag="${r.id}" title="Drag onto a project in the sidebar to move it"><span class="ctitle">${esc(convTitle(r))}</span><span class="cmeta">${size} prompt${size>1?'s':''}</span><button class="btn xs" data-convmenu="${r.id}" aria-haspopup="menu" aria-label="Chat options">⋯</button></div><ul class="tree" style="--lane:var(--l0)">${runHTML(r.id,0,pathSet)}</ul></section>`;
  }
  curLine=null;
  if(offN && shown.length) h+=`<p class="offnote" data-key="offnote">${offN} more chat${offN===1?'':'s'} in this project ${offN===1?'is':'are'} hidden.<button class="linkbtn" data-showall>Show all</button></p>`;
  }
  const fk=focusKey();
  treeEl.innerHTML=h;
  restoreFocus(fk);
  const ns=all();
  const headTxt = S.head && S.refs[S.head] ? `HEAD → ${refName(S.head)} @ #${S.refs[S.head].tip}` : (sel!=null ? `HEAD detached at #${sel}` : 'no HEAD');
  document.getElementById('stats').textContent=`${headTxt} · ${Object.keys(S.refs).length} branches · ${ns.length} prompts · ${ns.filter(n=>n.parents.length>1).length} merges`;
  document.getElementById('undoBtn').disabled=!undoStack.length;
  document.getElementById('redoBtn').disabled=!redoStack.length;
  const ct=document.getElementById('composeText'); if(ct && composeFor==='root') ct.focus({preventScroll:true});
  const bn=document.getElementById('branchName'); if(bn){ bn.focus({preventScroll:true}); bn.select(); }
  if(typeof scheduleMap==='function') scheduleMap();
}

/* every card in the right-hand bar: its first element is the always-visible header, the rest folds away */
const CARD_DEFAULT_OPEN = {io:false};
function setCard(card, key, html){
  const t=document.createElement('template'); t.innerHTML=html.trim();
  const head=t.content.firstElementChild, headHTML=head ? head.outerHTML : '';
  if(head) head.remove();
  const body=document.createElement('div'); body.append(t.content);
  const open = opts.open['card-'+key] ?? CARD_DEFAULT_OPEN[key] ?? true;
  card.innerHTML=`<details class="cardd" data-openkey="card-${key}" ${open?'open':''}><summary>${headHTML}</summary><div class="cardbody">${body.innerHTML}</div></details>`;
}
let editorFor = undefined, editBefore = null, savedTimer;
function renderEditor(){ editorFor=sel; }
function renderSpaces(){
  const ul=document.getElementById('spaceList');
  /* pinned projects on top */
  const ids=spaceIds(), pinned=ids.filter(id=>DB.spaces[id].pinned), rest=ids.filter(id=>!DB.spaces[id].pinned);
  const row=id=>{
    const sp=DB.spaces[id], cur=id===DB.current, st=spaceStats(sp.tree);
    if(renamingSpace===id) return `<li class="sp ${cur?'cur':''}" data-space="${id}"><input class="spinput" id="spname-${id}" data-spname="${id}" value="${esc(sp.name)}" maxlength="60" aria-label="Project name"></li>`;
    return `<li class="sp ${cur?'cur':''}" data-space="${id}"><button class="spmain" data-open="${id}" ${cur?'aria-current="page"':''}><span class="spname">${spaceUnread(id)&&!cur?'<span class="udot" aria-label="New replies"></span>':''}${sp.pinned?PIN:''}${esc(sp.name)}</span><span class="spmeta">${st.convs} chat${st.convs===1?'':'s'} · ${st.prompts} prompt${st.prompts===1?'':'s'}</span></button><button class="spmore" data-spmenu="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="Options for ${esc(sp.name)}">⋯</button></li>`;
  };
  ul.innerHTML = pinned.length ? `<li class="cvsec cvdate">Pinned</li>${pinned.map(row).join('')}${rest.length?`<li class="cvsec cvdate">Others</li>${rest.map(row).join('')}`:''}` : ids.map(row).join('');
  if(renamingSpace){ const inp=document.getElementById('spname-'+renamingSpace); if(inp){ inp.focus({preventScroll:true}); inp.select(); } }
}
function renderHeader(){
  const sp=DB.spaces[DB.current];
  document.getElementById('spaceTitle').textContent=sp.name;
  document.getElementById('convSpace').textContent='in '+sp.name;
}
let renamingConv=null;
const convListEl=document.getElementById('convList'), convFilterEl=document.getElementById('convFilter');
let selecting=false, choosing=null, pickingRows=false; const checked=new Set();
const EYE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.3 17.3 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
/* which chats the list shows: active, archived or all; read, unread or either; and unread ones first or not */
const listView = () => { const v=Object.assign({show:'active', read:'any', unreadFirst:false}, opts.convView); if(!['active','archived','all'].includes(v.show)) v.show='active'; if(!['any','unread','read'].includes(v.read)) v.read='any'; return v; };
function setListView(patch){ opts.convView=Object.assign(listView(), patch); save(); Motion.run(convListEl, renderConvs); }
function viewMenu2(anchor){
  const v=listView(), nArch=vRoots().filter(isArchived).length, nUnread=vRoots().filter(r=>convMeta(convKey(r)).unread).length, mark=(on, l)=>(on?'✓ ':'\u2003 ')+l;
  openMenu(anchor, [
    {heading:'Show'},
    {label:mark(v.show==='active', 'Active chats'), run:()=>setListView({show:'active'})},
    {label:mark(v.show==='archived', `Archived${nArch?` (${nArch})`:''}`), run:()=>setListView({show:'archived'})},
    {label:mark(v.show==='all', 'All chats'), run:()=>setListView({show:'all'})},
    {heading:'Read'},
    {label:mark(v.read==='any', 'Read and unread'), run:()=>setListView({read:'any'})},
    {label:mark(v.read==='unread', `Unread only${nUnread?` (${nUnread})`:''}`), run:()=>setListView({read:'unread'})},
    {label:mark(v.read==='read', 'Read only'), run:()=>setListView({read:'read'})},
    {sep:true},
    {label:mark(v.unreadFirst, 'Group unread first'), run:()=>setListView({unreadFirst:!v.unreadFirst})},
    {label:'\u2003 Mark all as read', disabled:!nUnread, run:()=>{ for(const r of vRoots()){ const m=S.convs[convKey(r)]; if(m) delete m.unread; } save(); Motion.run(convListEl, renderConvs); renderSpaces(); toast('Marked every chat as read'); }},
  ]);
}
function renderConvs(){
  const q=convFilterEl.value.trim().toLowerCase(), cur=composeFor==='root' ? null : convKeyOf(sel);
  const lv=listView(), arch=lv.show==='archived';
  const roots=orderedRoots();
  const base = lv.show==='archived' ? archivedRoots() : lv.show==='all' ? sortRoots(vRoots(), convSort()) : sortRoots(roots.slice(), convSort());
  const listed = base.filter(r=>lv.read==='any' || (lv.read==='unread') === !!convMeta(convKey(r)).unread);
  const list=listed.filter(r=>!q || convTitle(r).toLowerCase().includes(q)), onN=roots.filter(r=>!isHidden(r)).length, mode=visMode();
  const viewLabel=[{active:'Active chats', archived:'Archived', all:'All chats'}[lv.show], lv.read==='unread'?'unread':lv.read==='read'?'read':''].filter(Boolean).join(' · ');
  document.getElementById('cvBar').innerHTML=`<button class="btn xs cvsort cvviewbtn" data-cvviewmenu aria-haspopup="menu" aria-expanded="false" title="Active, archived or all chats; read or unread">${esc(viewLabel)} ▾</button><button class="btn xs cvsort" data-cvsort aria-haspopup="menu" aria-expanded="false" title="Sort and group the chat list">${esc(CONV_SORTS[convSort()])} ▾</button>`;
  for(const k of [...checked]) if(!roots.some(r=>convKey(r)===k)) checked.delete(k);
  const item=r=>{
    /* Chat view goes to any chat, so it shows none as hidden; nor does the Archived list */
    const k=convKey(r), archived=isArchived(r), on=opts.simple || archived || !isHidden(r), unread=!!convMeta(k).unread, pinned=isPinned(r), n=[...desc(r.id)].filter(x=>S.nodes[x].kind!=='merge').length+1;
    const b=Object.values(S.refs).filter(x=>S.nodes[x.tip] && convKeyOf(x.tip)===k).length;
    if(renamingConv===k) return `<li class="cv cur" data-key="cl${k}"><input class="spinput" id="cvname-${k}" data-cvname="${k}" value="${esc(convTitle(r))}" maxlength="120" aria-label="Conversation name"></li>`;
    const meta=`${n} prompt${n===1?'':'s'} · ${b} branch${b===1?'':'es'}`;
    if(selecting) return `<li class="cv ${on?'':'off'} ${checked.has(k)?'checked':''}" data-key="cl${k}"><input type="checkbox" class="cvcheck" id="ck-${k}" data-check="${k}" ${checked.has(k)?'checked':''} aria-label="Select ${esc(convTitle(r))}"><label class="cvmain" for="ck-${k}"><span class="cvname">${esc(convTitle(r))}</span><span class="cvmeta">${meta}</span></label></li>`;
    const tip = archived ? (opts.simple ? 'Open it (it stays archived)' : 'Archived. Click to bring it back and open it.') : opts.simple ? (cur===k ? 'The chat you’re in' : 'Open it') : pickingRows ? (on ? 'Shown. Click to hide it.' : 'Hidden. Click to show it.') : mode==='focus' ? (cur===k ? 'Click again to leave focus and show all chats' : 'Move the focus here')
      : !on ? 'Hidden. Click to show it and jump to it.'
      : cur===k ? (onN>1 ? 'Click again to hide the other chats' : 'Click again to show all chats') : 'Jump to it';
    return `<li class="cv ${cur===k&&!pickingRows?'cur':''} ${on?'':'off'} ${unread?'unread':''} ${archived&&!arch?'archived':''}" data-key="cl${k}" draggable="true" data-convdrag="${r.id}"><button class="cvmain" data-openconv="${k}" ${pickingRows&&!opts.simple&&!archived?`aria-pressed="${on}"`:(cur===k?'aria-current="true"':'')} title="${tip}${unread?' · New replies':''}"><span class="cvname">${unread?'<span class="udot" aria-label="Unread"></span>':''}${pinned&&!arch?PIN:''}${esc(convTitle(r))}${archived&&!arch?'<span class="cvtag">archived</span>':''}</span><span class="cvmeta">${meta}</span></button><button class="spmore" data-cvmenu="${r.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Options for this chat">⋯</button></li>`;
  };
  convListEl.classList.toggle('choosing', pickingRows && !opts.simple);
  /* pinned chats on top, then unread ones if asked, then the rest, grouped by date when sorted by date (as Claude's list is) */
  const sec = t => `<li class="cvsec cvdate">${esc(t)}</li>`;
  const byDate = list => { if(!convGrouped()) return list.map(item).join(''); let last=null, h=''; for(const r of list){ const g=dateGroup(convSort()==='updated' ? convUpdated(r) : convStarted(r)); if(g!==last){ h+=sec(g); last=g; } h+=item(r); } return h; };
  const grouped = list => {
    const pin = arch ? [] : list.filter(isPinned), rest = list.filter(r=>!pin.includes(r));
    const unr = lv.unreadFirst && lv.read==='any' ? rest.filter(r=>convMeta(convKey(r)).unread) : [], others = rest.filter(r=>!unr.includes(r));
    let h='';
    if(pin.length) h+=sec('Pinned')+pin.map(item).join('');
    if(unr.length) h+=sec('Unread')+unr.map(item).join('');
    if(others.length) h += (pin.length||unr.length) && !convGrouped() ? sec(unr.length ? 'Read' : 'Chats')+others.map(item).join('') : byDate(others);
    return h;
  };
  const emptyText = lv.read==='unread' ? 'Nothing unread.' : lv.read==='read' ? 'No read chats here.' : arch ? 'No archived chats.' : 'No chats yet.';
  if(!q && !filters.size) convListEl.innerHTML = list.length ? grouped(list) : `<li><p class="cvempty">${emptyText}</p></li>`;
  else if(!q){
    const hits=searchHits('');
    const what=[...filters].map(f=>({star:'starred',note:'with notes',skip:'left out'})[f]).join(', ');
    convListEl.innerHTML = `<li class="cvsec">Prompts ${what} <span>${hits.length>=60?'60+':hits.length}</span></li>` + (hits.length ? hits.map(h=>hitHTML(h, '')).join('') : `<li><p class="cvempty">No prompts ${what} in this project yet.</p></li>`);
  }
  else {
    const hits=searchHits(q);
    convListEl.innerHTML =
      `<li class="cvsec">Chats <span>${list.length}</span></li>` + (list.length ? list.map(item).join('') : '<li><p class="cvempty">No titles match.</p></li>') +
      `<li class="cvsec">In prompts and replies <span>${hits.length>=60?'60+':hits.length}</span></li>` +
      (hits.length ? hits.map(h=>hitHTML(h, q)).join('') : '<li><p class="cvempty">Nothing matches.</p></li>');
  }
  const tools=document.getElementById('cvTools'), none=checked.size?'':'disabled';
  tools.classList.toggle('selecting', selecting);
  tools.hidden = lv.show!=='active' && !selecting;
  tools.classList.remove('choosing');
  if(selecting){
    tools.innerHTML=`<div class="seltop"><span class="count">${checked.size} of ${roots.length} selected</span><button class="btn xs" data-bulk="${checked.size===roots.length?'none':'all'}">${checked.size===roots.length?'Select none':'Select all'}</button></div>
       <div class="selacts"><button class="btn xs" data-bulk="move" ${none} aria-haspopup="menu">Move to…</button></div>
       <div class="selfoot"><p class="selhint">Tick chats to move them together.</p><button class="btn xs primary" data-bulk="done">Done</button></div>`;
  } else {
    tools.innerHTML = roots.length>1 ? `<div class="vishead"><span class="vislabel">On the page</span><span class="count">${onN} of ${roots.length}</span></div>
      <div class="vismodes" data-mode="${mode}" role="group" aria-label="Which chats are on the page"><span class="vmpill" data-key="vmpill" aria-hidden="true"></span>${['select','focus'].map(m=>`<button class="vm" data-vismode="${m}" aria-pressed="${mode===m}">${VIS_LABEL[m]}</button>`).join('')}</div>
      <p class="vishint">${pickingRows ? 'Click chats to show or hide them. Press Done when you\u2019re finished.' : VIS_HINT[mode]}</p>
      ${mode==='select' ? viewsHTML() : ''}
      ${mode==='select' ? `<div class="pickacts"><button class="btn xs pickmode" data-pick="toggle" aria-pressed="${pickingRows}" title="${pickingRows?'Stop selecting':'Click chats in the list to show or hide them'}">${pickingRows?'Done':'Select…'}</button><button class="btn xs" data-pick="all">All</button><button class="btn xs" data-pick="invert">Invert</button><button class="btn xs" data-pick="none">None</button>${q&&list.length?`<button class="btn xs" data-pick="matches">Only the ${list.length} match${list.length===1?'':'es'}</button>`:''}</div>` : ''}` : '';
  }
  if(renamingConv!=null){ const inp=document.getElementById('cvname-'+renamingConv); if(inp){ inp.focus({preventScroll:true}); inp.select(); } }
  if(renamingView!=null){ const inp=document.getElementById('vname-'+renamingView); if(inp){ inp.focus({preventScroll:true}); inp.select(); } }
}
/* branches are managed in the map, where you can see them */
function renderBranches(){ if(typeof mapEl==='function' && !mapEl().hidden) renderMapView(); }
function branchesHTML(rootId){
  const rids=Object.keys(S.refs).filter(rid=>S.nodes[S.refs[rid].tip] && chain(S.refs[rid].tip)[0]===rootId)
    .sort((a,b)=>(refName(b)==='main')-(refName(a)==='main') || refName(a).localeCompare(refName(b)));
  return `<details class="mapbr" data-openkey="mapbr" ${opts.open.mapbr?'open':''}><summary>Branches · ${rids.length}</summary><ul class="branches">${rids.map(rid=>`<li class="${S.head===rid?'cur':''}">
    <button class="coBtn" data-co="${rid}" aria-label="Check out ${esc(refName(rid))}" aria-pressed="${S.head===rid}" title="${S.head===rid?'Checked out':'Check out'}"></button>
    <input id="br-${rid}" value="${esc(refName(rid))}" data-rename="${rid}" aria-label="Branch name" spellcheck="false" autocomplete="off">
    <span class="meta">#${S.refs[rid].tip}</span>
    <button class="btn xs danger" data-delbr="${rid}" ${rids.length<2?'disabled title="A chat keeps at least one branch"':''} aria-label="Delete branch ${esc(refName(rid))}">Delete</button></li>`).join('')}</ul>
    <p class="note">Edit a name to rename it. Deleting a branch keeps its prompts.</p></details>`;
}
function render(forceEditor){ renderSpaces(); renderSpaceFiles(); renderHeader(); if(morphingTools) renderConvs(); else Motion.run(convListEl, renderConvs); renderTree(); renderEditor(forceEditor); renderCtx(); renderBranches(); renderNotes(); refreshRunButtons(); }
function animRender(anchors, forceEditor){ Motion.run(treeEl, ()=>render(forceEditor), anchors); }
