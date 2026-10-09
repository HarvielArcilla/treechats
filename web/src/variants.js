/* Variants: sending the next prompt several ways at once. */

let variants=null;
function variantsHTML(forId){
  const v=variants, n=v.rows.filter(r=>r.text.trim()).length;
  const here=refsAt(forId), rid0=here.includes(S.head)?S.head:here[0];
  return `<div class="composer variants" data-key="vz${forId}">
    <p class="contLabel">Variants from #${forId} <span class="note">· each becomes its own branch</span></p>
    <ol class="vrows">${v.rows.map((r,i)=>`<li class="vrow"><textarea data-vtext="${i}" rows="2" aria-label="Variant ${i+1}" placeholder="${i?'Another wording, or the same prompt for another model':'Your prompt'}">${esc(r.text)}</textarea>
      <div class="vside"><select data-vtier="${i}" aria-label="Model for variant ${i+1}">${TIERS.map(([t,l])=>`<option value="${t}" ${r.tier===t?'selected':''}>${l.replace(/ \(.*\)/,'')}</option>`).join('')}</select>${v.rows.length>1?`<button class="fx" data-vdel="${i}" aria-label="Remove variant ${i+1}">×</button>`:''}</div></li>`).join('')}</ol>
    ${v.suggesting?'<p class="thinking note">Claude is suggesting wordings…</p>':''}
    <div class="bar"><button class="btn primary" data-vsend ${n?'':'disabled'}>Send ${n} variant${n===1?'':'s'}</button><button class="btn" data-vadd>+ Add variant</button><button class="btn" data-vgrid title="Try these wordings against several setups (models, thinking, effort, tools) and see the results side by side">Grid…</button>${sampleState==='ready'?`<button class="btn" data-vsuggest ${v.suggesting||!v.rows[0].text.trim()?'disabled':''} title="One quick request: Claude rewrites the first variant a few ways">${AI}Suggest wordings</button>`:''}<button class="btn" data-vcancel>Cancel</button></div>
    <p class="note">The first ${rid0?`continues <b>${esc(refName(rid0))}</b>`:'starts a branch'}; the others get their own. ${sampleState==='ready'&&n>1?'Claude answers each, and they open side by side in Compare.':''}</p></div>`;
}
function openVariants(id){
  if(id==null || !S.nodes[id] || S.nodes[id].kind==='merge') return;
  if(sel!==id) select(id);
  const t=document.getElementById('contText'), text=(t?t.value:draft)||'';
  const other=TIERS.map(x=>x[0]).find(x=>x!==opts.model);
  variants={rows:[{text, tier:opts.model}, {text, tier:other}], suggesting:false};
  alsoTargets.clear(); pick=null;
  animRender([id]);
  const f=treeEl.querySelector('[data-vtext="0"]'); if(f){ f.focus({preventScroll:true}); f.setSelectionRange(f.value.length,f.value.length); }
}
function paintVariants(){ const el=treeEl.querySelector('.composer.variants'); if(el && sel!=null) el.outerHTML=variantsHTML(sel); }
async function suggestWordings(){
  const v=variants; if(!v || !sampleFn || !sampleFn.json) return;
  const base=v.rows[0].text.trim(); if(!base) return;
  v.suggesting=true; paintVariants();
  try{
    const d=await sampleFn.json(fillPrompt('wordings', {message:clip(base,4000)}), {modelTier:'quick', cache:false});
    if(variants===v && Array.isArray(d)) for(const x of d.filter(x=>typeof x==='string' && x.trim()).slice(0,4)) v.rows.push({text:x.trim(), tier:v.rows[0].tier});
  }catch(e){ toast('Claude couldn\u2019t suggest wordings this time.'); }
  if(variants===v){ v.suggesting=false; paintVariants(); }
}
function sendVariants(){
  const v=variants, parent=sel; if(!v || parent==null) return;
  const rows=v.rows.filter(r=>r.text.trim()); if(!rows.length){ toast('Write at least one variant.'); return; }
  const same=rows.every(r=>r.text.trim()===rows[0].text.trim());
  const files=takePending(), conv=convOf(parent), here=refsAt(parent), rid0=here.includes(S.head)?S.head:here[0], made=[];
  variants=null; draft='';
  commit(`Sent ${rows.length} variant${rows.length===1?'':'s'} from #${parent}`, ()=>{
    rows.forEach((r,i)=>{
      const nid=S.nextId++; S.nodes[nid]={id:nid, parents:[parent], text:r.text.trim(), askTier:r.tier}; if(files) S.nodes[nid].files=clone(files);
      if(i===0 && rid0){ S.refs[rid0].tip=nid; S.head=rid0; }
      else { const r2=newRef(slugName(same ? r.tier : `variant-${i+1}`, conv), nid); if(i===0) S.head=r2; }
      made.push(nid);
    });
    sel=made[0];
  }, {action: rows.length>1 ? {label:'Compare', fn:()=>openCompare(parent)} : undefined});
  if(sampleState==='ready'){ wantReplies(made); if(made.length>1) openCompare(parent); }
}
