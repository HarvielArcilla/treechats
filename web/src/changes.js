/* Proposed changes: code Claude writes for a project file, shown as a diff to keep or drop part by part. */

/* ---- Proposed changes ----
   When a reply contains code for one of the project's files, it is shown as a proposed change under the reply:
   which files, and how many lines each adds and removes. Review opens the change as a diff in the file panel, where
   each part can be kept or dropped, and the result edited, before it is saved as a new version of the file (and to
   disk, for a linked folder). Nothing changes until you save.

   A code block belongs to a file when its path is on the line just before it (`src/app.ts`, **src/app.ts**, a heading),
   or in the block's first line (```ts src/app.ts, ```ts title="src/app.ts"), or when it is a unified diff naming the
   file. When Claude shows only part of a file, the part is placed where its first and last lines match the file;
   if they don't, the diff says so before anything is saved. Any other code block can be applied to a file you choose. */

/* the files a reply could change: the project's, then the prompt's own attachments */
function changeTargets(id){
  const out=[];
  (S.files||[]).forEach((m,i)=>{ if(m.kind!=='image') out.push({where:'s:'+i, m}); });
  for(const x of path(id)){ const n=S.nodes[x]; (n && n.files || []).forEach((m,i)=>{ if(m.kind!=='image') out.push({where:`n${x}:${i}`, m}); }); }
  return out;
}
const pathKey = m => (m.src && m.src.path) || m.name;
function findTarget(id, p){
  if(!p) return null;
  const q=p.replace(/^\.?\//,'').replace(/^[ab]\//,'').trim(); if(!q || q.length>200) return null;
  const ts=changeTargets(id);
  return ts.find(t=>pathKey(t.m)===q || t.m.name===q) || ts.find(t=>t.m.name.endsWith('/'+q) || pathKey(t.m).endsWith('/'+q)) || null;
}
/* code blocks in a reply, with the path each names, if any */
function codeBlocks(reply){
  const out=[], re=/(^|\n)([^\n]*)\n?```([^\n`]*)\n([\s\S]*?)\n```/g; let m;
  while((m=re.exec(reply))){
    const before=m[2]||'', info=(m[3]||'').trim(), body=m[4];
    const pathRe=/([\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,8}\b/;
    let p=null;
    const t=info.match(/(?:title|file|path)=["']?([^"'\s]+)/); if(t) p=t[1];
    else { const parts=info.split(/\s+/); if(parts.length>1 && pathRe.test(parts[1])) p=parts[1]; else if(parts[0] && /[/.]/.test(parts[0]) && pathRe.test(parts[0]) && !/^[a-z]+$/i.test(parts[0])) p=parts[0]; }
    if(!p){ const b=before.match(/`([^`]+)`\s*:?\s*$|\*\*([^*]+)\*\*\s*:?\s*$|^#{1,6}\s+(.+?)\s*:?\s*$|^([\w.@/-]+\.[A-Za-z0-9]{1,8})\s*:?\s*$/); const c=b && (b[1]||b[2]||b[3]||b[4]); if(c){ const pm=c.match(pathRe); if(pm) p=pm[0]; } }
    const isDiff = /^diff\b|^patch\b/i.test(info) || /^(---|\+\+\+) /m.test(body) && /^@@ /m.test(body);
    if(isDiff && !p){ const h=body.match(/^\+\+\+ (?:b\/)?(\S+)/m); if(h && h[1]!=='/dev/null') p=h[1]; }
    out.push({i:out.length, path:p, lang:info.split(/\s+/)[0]||'', body, diff:isDiff});
  }
  return out;
}

/* ---- line diff (Myers), and the hunks people keep or drop ---- */
function diffLines(a, b){
  const n=a.length, m=b.length, max=n+m, v=new Map([[1,0]]), trace=[];
  if(n*m > 4e7) return [{op:'del', a:0, b:0, lines:a}, {op:'add', a:n, b:0, lines:b}]; /* too big to compare line by line */
  outer: for(let d=0; d<=max; d++){
    trace.push(new Map(v));
    for(let k=-d; k<=d; k+=2){
      let x = (k===-d || (k!==d && (v.get(k-1)??-1) < (v.get(k+1)??-1))) ? (v.get(k+1)??0) : (v.get(k-1)??0)+1;
      let y=x-k;
      while(x<n && y<m && a[x]===b[y]){ x++; y++; }
      v.set(k, x);
      if(x>=n && y>=m) break outer;
    }
  }
  /* walk back to a list of equal / deleted / added runs */
  const ops=[]; let x=n, y=m;
  for(let d=trace.length-1; d>=0 && (x>0 || y>0); d--){
    const vv=trace[d], k=x-y;
    const prevK = (k===-d || (k!==d && (vv.get(k-1)??-1) < (vv.get(k+1)??-1))) ? k+1 : k-1;
    const px=vv.get(prevK)??0, py=px-prevK;
    while(x>px && y>py){ ops.push(['eq', a[x-1]]); x--; y--; }
    if(d>0){ if(x===px) ops.push(['add', b[y-1]]); else ops.push(['del', a[x-1]]); }
    x=px; y=py;
  }
  ops.reverse();
  return ops;
}
/* runs of changes with up to 3 lines of context, each one kept or dropped as a whole */
function makeHunks(ops){
  const hunks=[]; let cur=null, lastChange=-99;
  ops.forEach((o,i)=>{ if(o[0]!=='eq'){ if(!cur || i-lastChange>6){ cur={start:i, end:i, on:true}; hunks.push(cur); } cur.end=i; lastChange=i; } });
  return hunks;
}
function applyHunks(ops, hunks){
  const out=[];
  ops.forEach((o,i)=>{
    const h=hunks.find(h=>i>=h.start && i<=h.end), keep=h ? h.on : true;
    if(o[0]==='eq') out.push(o[1]);
    else if(o[0]==='add' && keep) out.push(o[1]);
    else if(o[0]==='del' && !keep) out.push(o[1]);
  });
  return out.join('\n');
}
/* a unified diff applied to text, each hunk found by its context (allowing it to have moved) */
function applyPatch(text, patch){
  let lines=text.split('\n'); const hs=[]; let h=null;
  for(const l of patch.replace(/\n+$/,'').split('\n')){
    if(/^@@ /.test(l)){ h={old:[], neu:[]}; hs.push(h); continue; }
    if(!h || /^(---|\+\+\+|diff |index )/.test(l)) continue;
    if(l.startsWith('+')) h.neu.push(l.slice(1)); else if(l.startsWith('-')) h.old.push(l.slice(1)); else if(l.startsWith(' ') || l===''){ h.old.push(l.slice(1)); h.neu.push(l.slice(1)); }
  }
  if(!hs.length) return null;
  let from=0;
  for(const hk of hs){
    let at=-1;
    for(let i=from; i<=lines.length-hk.old.length; i++){ let ok=true; for(let j=0;j<hk.old.length;j++) if(lines[i+j].trimEnd()!==hk.old[j].trimEnd()){ ok=false; break; } if(ok){ at=i; break; } }
    if(at<0) return null;
    lines=[...lines.slice(0,at), ...hk.neu, ...lines.slice(at+hk.old.length)]; from=at+hk.neu.length;
  }
  return lines.join('\n');
}
/* what the file would become: the whole block, a part placed where it matches, or a patch applied */
function proposedText(cur, block){
  if(block.diff){ const t=applyPatch(cur, block.body); return t==null ? {text:null, note:'The diff’s context doesn’t match the file as it is now, so it can’t be applied.'} : {text:t, note:null}; }
  const a=cur.replace(/\n$/,'').split('\n'), b=block.body.replace(/\n$/,'').split('\n'), trail=/\n$/.test(cur)?'\n':'';
  if(b.length >= a.length*0.6 || a.length<20) return {text:block.body.replace(/\n$/,'')+trail, note:null};
  /* looks like part of the file: place it between the lines its first and last lines match */
  const firstLine=b.find(l=>l.trim()), lastLine=[...b].reverse().find(l=>l.trim());
  const i=a.findIndex(l=>l.trim()===firstLine.trim()), j=i<0 ? -1 : a.findIndex((l,k)=>k>=i && l.trim()===lastLine.trim());
  if(i>=0 && j>=i) return {text:[...a.slice(0,i), ...b, ...a.slice(j+1)].join('\n')+trail, note:`Claude showed part of the file; it replaces lines ${i+1}–${j+1}.`, partial:true};
  return {text:block.body.replace(/\n$/,'')+trail, note:'This looks like only part of the file, and it couldn’t be placed, so the diff replaces the whole file. Drop the parts you don’t want, or copy what you need instead.', warn:true};
}
function changeStats(cur, nu){ const ops=diffLines(cur.split('\n'), nu.split('\n')); return {add:ops.filter(o=>o[0]==='add').length, del:ops.filter(o=>o[0]==='del').length}; }
const propCache=new Map();
function proposalsFor(id){
  const n=S.nodes[id]; if(!n || !n.reply) return [];
  const key=n.reply+'|'+changeTargets(id).map(t=>t.m.id).join(',');
  const hit=propCache.get(id); if(hit && hit.key===key) return hit.list;
  const list=[];
  for(const b of codeBlocks(n.reply)){
    const t=findTarget(id, b.path); if(!t) continue;
    const r=Files.get(t.m.id); if(!r || r.kind!=='text') continue;
    const p=proposedText(r.text, b); if(p.text==null){ list.push({b, t, error:p.note}); continue; }
    if(p.text===r.text) continue;
    list.push({b, t, ...changeStats(r.text, p.text)});
  }
  propCache.set(id, {key, list});
  return list;
}
function proposalsHTML(id){
  const n=S.nodes[id]; if(!n || !n.reply || liveGen(id)) return '';
  const ps=proposalsFor(id), blocks=codeBlocks(n.reply), files=changeTargets(id).length;
  const applied=Object.keys(n.applied||{});
  if(!ps.length && !applied.length && !(blocks.length && files)) return '';
  const row=p=>`<button class="propfile" data-propview="${id}:${p.b.i}" title="${esc(p.error || 'Review this change as a diff before saving it')}"><span class="pfname">${esc(clipStart(pathKey(p.t.m), 48))}</span>${p.error?'<span class="pfstat bad">can’t apply</span>':`<span class="pfstat"><span class="pfadd">+${p.add}</span> <span class="pfdel">−${p.del}</span></span>`}</button>`;
  const other = blocks.length>ps.length && files ? `<button class="rmore" data-propany="${id}" title="Choose a code block and the file it should go in">Apply a code block to a file…</button>` : '';
  const done=applied.filter(nm=>!ps.some(p=>p.t.m.name===nm)).map(nm=>`<span class="propfile done" title="Saved from this reply">${esc(clipStart(nm.replace(/^[^/]+\//,''), 48))} <span class="pfstat">saved</span></span>`).join('');
  return `<div class="proposals" data-key="pr${id}">${ps.length?`<span class="plabel">Proposed change${ps.length===1?'':'s'}</span>${ps.map(row).join('')}`:applied.length?'<span class="plabel">Changes</span>':''}${done}${other}</div>`;
}
/* the diff in the file panel */
function openProposal(id, blockIdx, where){
  const n=S.nodes[id]; if(!n) return;
  const b=codeBlocks(n.reply||'')[blockIdx]; if(!b) return;
  const t = where ? {where, m:fileAt(where)} : findTarget(id, b.path); if(!t || !t.m) return;
  const r=Files.get(t.m.id); if(!r){ toast(`${t.m.name} isn’t stored in this browser.`); return; }
  const p=proposedText(r.text, b);
  if(p.text==null){ toast(p.note); return; }
  const ops=diffLines(r.text.split('\n'), p.text.split('\n'));
  fileView={where:t.where, id:t.m.id, mode:'diff', saveDisk:true, ret:document.activeElement, diff:{from:id, block:blockIdx, ops, hunks:makeHunks(ops), note:p.note, warn:!!p.warn}};
  showPane(); paintFileView();
}
function diffHTML(fv){
  const d=fv.diff; let h='', ln=0, rn=0;
  const ctx=new Set(); d.ops.forEach((o,i)=>{ if(o[0]!=='eq') for(let k=i-3;k<=i+3;k++) ctx.add(k); });
  let gap=false;
  d.ops.forEach((o,i)=>{
    if(o[0]!=='del') rn++; if(o[0]!=='add') ln++;
    if(!ctx.has(i)){ if(!gap){ h+='<div class="dgap">⋯</div>'; gap=true; } return; }
    gap=false;
    const hk=d.hunks.findIndex(x=>i===x.start);
    if(hk>=0){ const x=d.hunks[hk]; h+=`<div class="dhunk"><label class="chk"><input type="checkbox" data-dhunk="${hk}" ${x.on?'checked':''}> Keep this change</label></div>`; }
    const inH=d.hunks.find(x=>i>=x.start && i<=x.end), off = inH && !inH.on;
    const cls=o[0]==='add'?'dadd':o[0]==='del'?'ddel':'deq';
    h+=`<div class="dline ${cls}${off?' off':''}"><span class="dno">${o[0]==='add'?'':ln}</span><span class="dno">${o[0]==='del'?'':rn}</span><span class="dsig">${o[0]==='add'?'+':o[0]==='del'?'−':' '}</span><span class="dtxt">${esc(o[1])||' '}</span></div>`;
  });
  return h || '<p class="note">No differences.</p>';
}
function diffResult(fv){ return applyHunks(fv.diff.ops, fv.diff.hunks); }
function proposalAnyMenu(anchor, id){
  const n=S.nodes[id], blocks=codeBlocks(n.reply||''), ts=changeTargets(id);
  const label=b=>`${b.path?b.path+' · ':''}${b.lang||'code'} · ${clip(b.body.split('\n').find(l=>l.trim())||'', 40)}`;
  openMenu(anchor, [{heading:'Which code block?'}, ...blocks.map(b=>({label:label(b), run:()=>setTimeout(()=>openMenu(anchor, [{heading:'Into which file?'}, ...ts.map(t=>({label:pathKey(t.m), run:()=>openProposal(id, b.i, t.where)}))]), 0)}))]);
}
