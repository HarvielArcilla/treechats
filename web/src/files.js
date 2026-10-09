/* Attached and project files: reading what you attach, and the file chips on prompts. */

/* ---- Files ----
   Attachment contents live in IndexedDB (browser storage made for larger data); prompts and spaces keep only a small
   reference. Text and code files go to Claude as text. Images go as images on the turn being answered. */
const TEXT_EXT=/\.(txt|md|mdx|markdown|csv|tsv|json|jsonc|json5|jsonl|geojson|xml|xhtml|plist|csproj|yaml|yml|toml|ini|cfg|conf|properties|editorconfig|env|log|sql|psql|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|mts|cts|py|pyi|pyw|rb|rake|gemspec|go|rs|java|kt|kts|swift|m|mm|c|h|cc|cpp|cxx|hpp|hh|hxx|cs|csx|fs|fsx|vb|php|sh|bash|zsh|fish|ksh|ps1|psm1|psd1|bat|cmd|r|lua|pl|pm|scala|sc|sbt|dart|ex|exs|erl|hrl|hs|lhs|ml|mli|clj|cljs|cljc|edn|elm|jl|nix|vue|svelte|astro|hbs|handlebars|twig|tex|sty|rst|proto|graphql|gql|wat|f90|cmake|mk|dockerfile|containerfile|makefile|gradle|groovy|tf|tfvars|hcl|zig|sol|vim|diff|patch)$/i;
const MAX_TEXT_FILE=300*1024, MAX_IMAGE_FILE=20*1024*1024;
const Files=(()=>{
  /* With the password lock on, each record is encrypted (AES-GCM) before it is stored, with a key the server derives
     from the lock's data key and hands to the page only while unlocked. The cache in memory holds them readable. */
  const cache=new Map(); let db=null, key=null, keyB64=null;
  const open=()=>new Promise(res=>{ try{ const r=indexedDB.open('treechats-files',1); r.onupgradeneeded=()=>r.result.createObjectStore('f'); r.onsuccess=()=>{ db=r.result; res(); }; r.onerror=()=>res(); }catch(e){ res(); } });
  async function useKey(b64){
    key = b64 ? await crypto.subtle.importKey('raw', Uint8Array.from(atob(b64), c=>c.charCodeAt(0)), 'AES-GCM', false, ['encrypt','decrypt']) : null; keyB64=b64||null;
  }
  /* a record as bytes: its details as JSON, then the image itself if it is one */
  async function seal(rec){
    const {blob, ...meta}=rec, m=new TextEncoder().encode(JSON.stringify(meta)), bytes=blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(0);
    const plain=new Uint8Array(4+m.length+bytes.length); new DataView(plain.buffer).setUint32(0, m.length); plain.set(m, 4); plain.set(bytes, 4+m.length);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    return {enc:1, iv, data:await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, plain)};
  }
  async function unseal(x){
    const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:x.iv}, key, x.data)), n=new DataView(plain.buffer).getUint32(0);
    const meta=JSON.parse(new TextDecoder().decode(plain.subarray(4, 4+n)));
    if(meta.kind==='image') meta.blob=new Blob([plain.subarray(4+n)], {type:meta.type});
    return meta;
  }
  /* resolves once the browser has really written it */
  function store(id, rec){
    if(!db) return Promise.resolve();
    return (key ? seal(rec) : Promise.resolve(rec)).then(v=>new Promise(res=>{ try{ const tx=db.transaction('f','readwrite'); tx.objectStore('f').put(v, id); tx.oncomplete=()=>res(); tx.onerror=tx.onabort=()=>res(); }catch(e){ res(); } })).catch(()=>{});
  }
  async function init(){
    const L=window.TREECHATS_LOCAL;
    if(L && L.lock && L.lock.on){ try{ const r=await fetch('/api/vault/fileskey'); if(r.ok) await useKey((await r.json()).key); }catch(e){} }
    await open(); if(!db) return;
    const raw=[];
    await new Promise(res=>{ try{ const rq=db.transaction('f').objectStore('f').openCursor(); rq.onsuccess=()=>{ const c=rq.result; if(c){ raw.push([c.key, c.value]); c.continue(); } else res(); }; rq.onerror=()=>res(); }catch(e){ res(); } });
    const plainLeft=[];
    for(const [id, v] of raw){
      if(v && v.enc){ if(key) try{ cache.set(id, await unseal(v)); }catch(e){ /* sealed with another key: shown as missing */ } }
      else { cache.set(id, v); if(key) plainLeft.push(id); }
    }
    /* files saved readable before the lock was on (another tab, say) are sealed now */
    for(const id of plainLeft) store(id, cache.get(id));
    await sync();
  }
  /* The server keeps every file; this browser's copy is a cache. On start: files the server has and this browser
     doesn't come down (another browser added them), and files only this browser has go up (saved before the server
     kept files, or while it was unreachable). */
  const online = () => { const L=window.TREECHATS_LOCAL; return !!(L && !L.offline); };
  async function sync(){
    if(!online()) return;
    let ids; try{ const r=await fetch('/api/files'); if(!r.ok) return; ids=new Set(await r.json()); }catch(e){ return; }
    const missing=[...ids].filter(id=>!cache.has(id));
    await Promise.all(missing.map(async id=>{ try{ const r=await fetch('/api/files/'+encodeURIComponent(id)); if(!r.ok) return; const rec=fromServer(await r.json()); cache.set(id, rec); store(id, rec); }catch(e){} }));
    const up=[...cache.keys()].filter(id=>!ids.has(id));
    (async()=>{ for(const id of up) await upload(id, cache.get(id)); })();
  }
  const b64 = async blob => { const u=new Uint8Array(await blob.arrayBuffer()); let s=''; for(let i=0; i<u.length; i+=0x8000) s+=String.fromCharCode.apply(null, u.subarray(i, i+0x8000)); return btoa(s); };
  function fromServer(f){
    const {data, ...rec}=f;
    if(rec.kind==='image' && typeof data==='string') rec.blob=new Blob([Uint8Array.from(atob(data), c=>c.charCodeAt(0))], {type:rec.type||'image/png'});
    return rec;
  }
  async function upload(id, rec){
    if(!online() || !rec) return;
    try{
      const {blob, ...meta}=rec, body={...meta, ...(rec.kind==='image' && blob ? {data:await b64(blob)} : {})};
      if(rec.kind==='image' && !blob) return;
      const r=await fetch('/api/files/'+encodeURIComponent(id), {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
      if(!r.ok) console.warn('Treechats could not save a file to the server:', r.status);
    }catch(e){ console.warn('Treechats could not save a file to the server:', e); }
  }
  function put(id, rec){ cache.set(id, rec); store(id, rec); upload(id, rec); }
  /* the lock was turned on or off: every file is stored again, sealed with the new key or readable */
  async function rekey(b64){ await useKey(b64); await Promise.all([...cache].map(([id, rec])=>store(id, rec))); }
  return {init, put, rekey, get:id=>cache.get(id), persistent:()=>!!db, sealed:()=>!!key, keyNow:()=>keyB64};
})();
async function readFiles(list, {textOnly=false}={}){
  const out=[];
  for(const f of list){
    const name=f.name || (f.type.startsWith('image/') ? 'pasted-image.'+(f.type.split('/')[1]||'png') : 'file');
    const isImage=f.type.startsWith('image/'), isText=!isImage && (f.type.startsWith('text/') || /json|xml|javascript|yaml|csv/.test(f.type) || TEXT_EXT.test(name));
    if(isImage && textOnly){ toast(`${name}: project files are sent as text, so images can only be attached to a prompt.`); continue; }
    if(isImage){ if(f.size>MAX_IMAGE_FILE){ toast(`${name} is over 20 MB. Try a smaller image.`); continue; } }
    else if(isText){ if(f.size>MAX_TEXT_FILE){ toast(`${name} is ${fmtSize(f.size)}. Text files can be up to 300 KB here.`); continue; } }
    else { toast(`${name}: only text, code and image files can be attached for now.`); continue; }
    const id='f'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const rec={name, type:f.type||'text/plain', size:f.size, kind:isImage?'image':'text'};
    if(isImage) rec.blob=f; else rec.text=await f.text();
    Files.put(id, rec);
    out.push({id, name, kind:rec.kind, size:f.size});
  }
  if(out.length && !Files.persistent()) toast('This browser won\u2019t store files, so attachments last until you close the page.');
  return out;
}
const fileBlock = m => { const r=Files.get(m.id); return r && r.kind==='text' ? `<file name="${m.name}">\n${r.text}\n</file>` : `[Attached image: ${m.name}]`; };
/* where: "p" (waiting in the input box) or "n12" (attached to #12), so a click opens the file viewer */
function fileChips(files, removable, where){
  if(!files || !files.length) return '';
  const many=files.length>6 && !removable;
  const shown=many ? files.slice(0,5) : files;
  return `<span class="fchips">${shown.map((m,i)=>`<span class="fchip ${Files.get(m.id)?'':'missing'}" title="${esc(m.name)} · ${fmtSize(m.size)}${Files.get(m.id)?' · click to open':' · not on this device'}">${where?`<button class="fopen" data-fileopen="${where}:${i}">`:''}<span class="fkind">${m.kind==='image'?'IMG':'TXT'}</span>${esc(clipStart(m.name,32))}${where?'</button>':''}${removable?`<button class="fx" data-unattach="${i}" aria-label="Remove ${esc(m.name)}">×</button>`:''}</span>`).join('')}${many?`<span class="fchip">+${files.length-5} more</span>`:''}</span>`;
}
/* long paths keep their end, where the file name is */
const clipStart = (s, n) => s.length>n ? '…'+s.slice(s.length-n+1) : s;
let pendingFiles=[];
let draft='', draftRoot='';
/* extra prompts the next message also goes to, besides the selected one (Ctrl/⌘- or Shift-click to add) */
const alsoTargets=new Set();
function pruneAlso(){ for(const x of [...alsoTargets]) if(!S.nodes[x] || x===sel || isHidden(S.nodes[chain(x)[0]])) alsoTargets.delete(x); }
