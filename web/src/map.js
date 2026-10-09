/* The branch map. */

/* ---- Branch map ----
   The conversation as a graph, the way `git log --graph` draws history: one row per prompt, oldest at the top, a
   column per branch line, curves where a branch forks off and dashed lines where one is merged back. Lane colors
   match the tree. A small one sits in the conversations panel; the full one (M, or Map in the top bar) lists every
   prompt beside its dot. Clicking either goes to that prompt. */
function mapLayout(rootId){
  const rows=[], forks=[], lines=[], merges=[], pos=new Map(), active=new Set(); let cols=1;
  (function lay(id, col, lane){
    const i=rows.length; rows.push({id, col, lane}); pos.set(id, i); cols=Math.max(cols, col+1);
    const ks=vKids(id), straight=ks.find(k=>trunk.has(k.id)) || ks[0], side=ks.filter(k=>k!==straight);
    if(straight) active.add(col);
    const used=new Set([lane]);
    for(const k of side){
      let l=laneFor(k.alt ?? k.id, lane); for(let t=0; used.has(l) && t<3; t++) l=l%3+1; used.add(l);
      let c=col+1; while(active.has(c)) c++;
      forks.push({from:id, to:k.id, lane:l, plane:lane});
      lay(k.id, c, l);
    }
    if(straight){ active.delete(col); lines.push({from:id, to:straight.id, lane}); lay(straight.id, col, lane); }
  })(rootId, 0, 0);
  for(const r of rows) for(const k of vSec(r.id)) if(pos.has(k.id)) merges.push({from:r.id, to:k.id});
  /* each merge line runs down a lane of its own to the right of the branches, so it never crosses a prompt;
     merges whose spans don't overlap share a lane */
  const rails=[];
  for(const m of merges.sort((a,b)=>pos.get(a.from)-pos.get(b.from))){
    const a=pos.get(m.from), b=pos.get(m.to);
    let k=rails.findIndex(end=>end<a); if(k<0){ k=rails.length; rails.push(b); } else rails[k]=b;
    m.rail=cols+k;
  }
  return {rows, forks, lines, merges, pos, cols:cols+rails.length};
}
/* the lines and dots; x/y place a column and a row */
function mapGraphSVG(L, x, y, r, pathSet){
  const st=l=>`style="stroke:var(--l${l})"`, P=L.pos, col=id=>L.rows[P.get(id)].col;
  let g='';
  for(const e of L.lines) g+=`<line x1="${x(col(e.from))}" y1="${y(P.get(e.from))}" x2="${x(col(e.to))}" y2="${y(P.get(e.to))}" ${st(e.lane)} stroke-width="${r*.7}" opacity="${pathSet.has(e.to)?1:.55}"/>`;
  for(const e of L.forks){
    const x0=x(col(e.from)), y0=y(P.get(e.from)), x1=x(col(e.to)), y1=y(P.get(e.to)), bend=Math.min(y1-y0, (y(1)-y(0))*1.2);
    if(y1-y0>bend) g+=`<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1-bend}" ${st(e.plane)} stroke-width="${r*.7}" opacity=".55"/>`;
    g+=`<path d="M${x0} ${y1-bend} C${x0} ${y1-bend*.35} ${x1} ${y1-bend*.65} ${x1} ${y1}" fill="none" ${st(e.lane)} stroke-width="${r*.7}" opacity="${pathSet.has(e.to)?1:.55}"/>`;
  }
  for(const e of L.merges){
    const x0=x(col(e.from)), y0=y(P.get(e.from)), x1=x(col(e.to)), y1=y(P.get(e.to)), xr=x(e.rail), d=Math.min((y1-y0)/2, (y(1)-y(0))*.9);
    g+=`<path d="M${x0} ${y0} C${xr} ${y0} ${xr} ${y0} ${xr} ${y0+d} L${xr} ${y1-d} C${xr} ${y1} ${xr} ${y1} ${x1} ${y1}" fill="none" style="stroke:var(--merge)" stroke-width="${r*.6}" stroke-dasharray="${r} ${r*.8}" opacity=".85"/>`;
  }
  for(const row of L.rows){
    const n=S.nodes[row.id], cx=x(row.col), cy=y(P.get(row.id)), on=pathSet.has(row.id);
    if(n.kind==='merge') g+=`<rect x="${cx-r}" y="${cy-r}" width="${r*2}" height="${r*2}" transform="rotate(45 ${cx} ${cy})" style="fill:var(--merge)"/>`;
    else g+=`<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${n.skip?'var(--surface)':`var(--l${row.lane})`};stroke:var(--l${row.lane})" stroke-width="${n.skip?r*.5:0}" opacity="${on?1:.6}"/>`;
    if(row.id===sel) g+=`<circle cx="${cx}" cy="${cy}" r="${r*1.9}" fill="none" style="stroke:var(--accent)" stroke-width="${Math.max(1.2,r*.55)}"/>`;
  }
  return g;
}
const mapRoot = () => { const k=lastConvKey(); const r=k!=null ? vRoots().find(x=>convKey(x)===k) : null; return r || orderedRoots()[0] || null; };
const ovEl=()=>document.getElementById('ovMap'), ovSvg=()=>document.getElementById('ovSvg');
let ovRows=null, mapTimer=null;
function scheduleMap(){ clearTimeout(mapTimer); mapTimer=setTimeout(drawMap, 120); if(!mapEl().hidden) renderMapView(); }
function drawMap(){
  const el=ovEl(); if(!el) return;
  const root=composeFor==='root' ? null : mapRoot();
  const L=root ? mapLayout(root.id) : null;
  const has=!!L && L.rows.length>1, show=has && opts.map!==false;
  el.hidden=!has; el.classList.toggle('collapsed', has && !show); ovRows=null; if(!show) return;
  const w=Math.max(140, el.clientWidth || 220), pad=7;
  const colW=Math.min(13, (w-pad*2)/Math.max(1, L.cols)), rowH=Math.max(1.5, Math.min(11, 260/L.rows.length));
  const r=Math.max(1.4, Math.min(3.4, rowH*.32, colW*.3)), h=L.rows.length*rowH+pad*2;
  const gx=c=>pad+colW*c+colW/2, gy=i=>pad+i*rowH+rowH/2, pathSet=new Set(sel!=null && S.nodes[sel] ? path(sel) : []);
  const hit=L.rows.map((row,i)=>`<rect class="mrow" x="0" y="${pad+i*rowH}" width="${w}" height="${rowH}" fill="transparent" rx="2"><title>#${row.id} ${esc(clip(plainText(S.nodes[row.id].kind==='merge' ? 'Merged '+(S.nodes[row.id].from||'') : S.nodes[row.id].text), 90))}${refsAt(row.id).length?' · '+refsAt(row.id).map(refName).join(', '):''}</title></rect>`).join('');
  const svg=ovSvg(); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.innerHTML=hit+mapGraphSVG(L, gx, gy, r, pathSet);
  ovRows={rows:L.rows, pad, rowH};
}
ovSvg().addEventListener('click', e=>{
  if(!ovRows) return;
  const b=ovSvg().getBoundingClientRect(), vb=ovSvg().viewBox.baseVal, yy=(e.clientY-b.top)*(vb.height/b.height);
  const i=Math.floor((yy-ovRows.pad)/ovRows.rowH), row=ovRows.rows[Math.max(0, Math.min(ovRows.rows.length-1, i))];
  if(row) goFromMap(row.id);
});
document.getElementById('ovMap').addEventListener('click', e=>{
  if(e.target.closest('[data-maphide]')){ opts.map=false; save(); drawMap(); }
  if(e.target.closest('[data-mapshow]')){ opts.map=true; save(); drawMap(); }
  if(e.target.closest('[data-mapopen]')) openMapView();
});
window.addEventListener('resize', scheduleMap);
function goFromMap(id){
  const n=S.nodes[id]; if(!n) return;
  if(!mapEl().hidden) closeMapView(true);
  closeDrawers();
  if(opts.simple) simpleTip=null;
  select(n.kind==='merge' ? n.parents[0] : id);
}

/* the full map */
const mapEl=()=>document.getElementById('mapView');
let mapReturn=null;
function openMapView(){
  if(!mapRoot()){ toast('Start a chat first. The map shows its branches.'); return; }
  mapReturn=document.activeElement; closeMenu && menuEl && closeMenu();
  mapEl().hidden=false; document.body.style.overflow='hidden';
  renderMapView();
  const cur=mapEl().querySelector('.maprow.sel') || mapEl().querySelector('.maprow');
  if(cur){ cur.focus({preventScroll:true}); cur.scrollIntoView({block:'center'}); }
}
function closeMapView(keepFocus){ mapEl().hidden=true; document.body.style.overflow=''; if(!keepFocus && mapReturn && mapReturn.focus && document.contains(mapReturn)) mapReturn.focus({preventScroll:true}); }
function renderMapView(){
  const box=mapEl().querySelector('.mapbox'), root=mapRoot(); if(!root){ closeMapView(); return; }
  const L=mapLayout(root.id), rowH=30, colW=18, pad=4, r=4.6, gw=pad*2+colW*L.cols+6;
  const gx=c=>pad+colW*c+colW/2, gy=i=>i*rowH+rowH/2, pathSet=new Set(sel!=null && S.nodes[sel] ? path(sel) : []);
  const nTips=Object.values(S.refs).filter(x=>S.nodes[x.tip] && chain(x.tip)[0]===root.id).length;
  const rows=L.rows.map(row=>{
    const n=S.nodes[row.id], refs=refsAt(row.id);
    const pills=refs.map(rid=>`<span class="ref ${S.head===rid?'head':''}">${S.head===rid?'HEAD → ':''}${esc(refName(rid))}</span>`).join('');
    const tags=(n.star?'<span class="tag">★</span>':'')+(n.skip?'<span class="tag skiptag">left out</span>':'')+(n.reply?'':n.kind==='merge'?'':'<span class="tag">no reply</span>');
    const txt = n.kind==='merge' ? `Merged <b>${esc(n.from||'#'+n.parents[1])}</b> into <b>${esc(n.into||'#'+n.parents[0])}</b>` : esc(clip(plainText(n.text)||'(empty)', 160));
    return `<button class="maprow ${row.id===sel?'sel':''} ${pathSet.has(row.id)?'':'off'} ${n.kind==='merge'?'merge':''}" data-mapgo="${row.id}" style="height:${rowH}px;padding-left:${gw}px" title="${esc(clip(plainText(n.text||''), 400))}"><span class="mid">#${row.id}</span><span class="mtxt">${txt}</span><span class="mtags">${tags}${pills}</span></button>`;
  }).join('');
  box.innerHTML=`<div class="sethead"><div class="cmptitle"><h2 id="mapTitle">Branch map</h2><p class="note">${esc(clip(convTitle(root),120))} · ${L.rows.filter(x=>S.nodes[x.id].kind!=='merge').length} prompts · ${nTips} branch${nTips===1?'':'es'}</p></div><div class="bar"><button class="btn" data-mapclose>Close <kbd class="inv">Esc</kbd></button></div></div>
    <div class="mapbody">${branchesHTML(root.id)}<div class="mapgraph"><svg width="${gw}" height="${L.rows.length*rowH}" aria-hidden="true">${mapGraphSVG(L, gx, gy, r, pathSet)}</svg><div class="maprows">${rows}</div></div></div>`;
}
mapEl().addEventListener('click', e=>{
  if(e.target===mapEl() || e.target.closest('[data-mapclose]')){ closeMapView(); return; }
  const co=e.target.closest('[data-co]'); if(co){ checkout(co.dataset.co); renderMapView(); return; }
  const db=e.target.closest('[data-delbr]'); if(db && !db.disabled){ deleteRef(db.dataset.delbr); return; }
  const g=e.target.closest('[data-mapgo]'); if(g) goFromMap(+g.dataset.mapgo);
});
mapEl().addEventListener('change', e=>{ if(e.target.dataset.rename!=null) renameRef(e.target.dataset.rename, e.target.value); });
mapEl().addEventListener('toggle', e=>{ if(e.target.dataset && e.target.dataset.openkey==='mapbr'){ opts.open.mapbr=e.target.open; save(); } }, true);
mapEl().addEventListener('keydown', e=>{
  if(e.target.dataset && e.target.dataset.rename!=null && e.key==='Enter'){ e.target.blur(); return; }
  if(e.key!=='ArrowDown' && e.key!=='ArrowUp') return;
  const rows=[...mapEl().querySelectorAll('.maprow')], i=rows.indexOf(document.activeElement);
  const t=rows[Math.max(0, Math.min(rows.length-1, (i<0?0:i)+(e.key==='ArrowDown'?1:-1)))];
  if(t){ e.preventDefault(); t.focus(); t.scrollIntoView({block:'nearest'}); }
});
document.getElementById('mapBtn').addEventListener('click', ()=>openMapView());

for(const name of ['select','render','renderTree','renderConvs','renderCtx','renderBranches','renderEditor','renderNotes','renderCompare','paletteCommands','treeMarkdown','pathMarkdown','drawMap','renderMapView']){
  const f=window[name]; if(typeof f==='function') window[name]=function(...a){ return withGraph(()=>f.apply(this,a)); };
}
