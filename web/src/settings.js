/* The Settings panel, and Privacy & security (encryption, the password lock, the API key). */

/* ---- Privacy & security ----
   Where your data is, the password lock (server/vault.ts), the API key in the system keychain (server/secrets.ts),
   and the token that signs browsers and coding tools in. */
const lockInfo = () => (window.TREECHATS_LOCAL && window.TREECHATS_LOCAL.lock) || {on:false};
const AUTO_LOCKS=[[5,'5 min'],[15,'15 min'],[60,'1 hour'],[240,'4 hours'],[1440,'1 day'],[0,'Never']];
let priv={form:null, recovery:null, recoveryFor:null, busy:false, err:'', offMode:'off'};
function autoLockText(n){ const x=AUTO_LOCKS.find(a=>a[0]===n); return n ? `after ${x?x[1]:n+' min'} without use` : 'only when you lock it or Treechats stops'; }
function privacyHTML(){
  if(!hasServer()) return `<section class="setsec"><p class="note">This page isn’t connected to the Treechats server, so everything is kept in this browser’s storage.</p></section>`;
  const L=window.TREECHATS_LOCAL, lk=lockInfo(), key=L.key||{}, err=priv.err?`<p class="perr" role="alert">${esc(priv.err)}</p>`:'', busy=priv.busy?'disabled':'';
  const pw=(name, label, auto)=>`<label class="pfield">${label}<input type="password" data-pw="${name}" autocomplete="${auto}" ${busy}></label>`;
  let h=`<section class="setsec"><h3>Your data</h3>
    <p class="note">Your chats, projects and settings are saved in <code>${esc(L.dataDir||'the data folder')}</code>, which only your account on this computer can open${lk.on?', and they are encrypted':''}. Attachments are kept in this browser’s storage${lk.on?', also encrypted':''}. Files from linked folders stay where they are. Nothing is sent anywhere except the requests to Claude you make.</p>
    <p class="note">The best protection for a lost or stolen computer is disk encryption: FileVault on a Mac, BitLocker or Device encryption on Windows, or full-disk encryption on Linux. It covers Treechats and everything else.</p></section>`;
  const recBox = priv.recovery ? `<div class="recbox"><b>Your recovery key</b><code class="reccode">${esc(priv.recovery)}</code>
      <p class="note">If you forget your password, or move to another computer, this is the only way back in. Nobody else can recover your chats: not Treechats, not anyone. Save it somewhere safe that isn’t this computer, like a password manager or on paper. It won’t be shown again.</p>
      <div class="tbar"><button class="btn" data-reccopy>Copy</button><button class="btn" data-recsave>Save as a file</button><button class="btn primary" data-recdone>I’ve saved it</button></div></div>` : '';
  /* encryption */
  h+=`<section class="setsec"><h3>Encryption</h3>`;
  if(priv.recovery && priv.recoveryFor==='encrypt') h+=recBox;
  else if(lk.on && lk.password) h+=`<p class="note">On, because the password lock is on. Your chats, settings and attachments are encrypted with a key only your password or recovery key opens.</p>`;
  else if(lk.on) h+=`<p class="note">On. Your chats, settings and attachments are encrypted, and the key is kept in ${esc(lk.keychain||'the system keychain')}, so Treechats opens without asking. Copies of the data folder (backups, sync, a copied disk) can’t be read without it. On another computer, your recovery key opens it.</p>
      <div class="tbar"><button class="btn" data-lockform="recovery" aria-pressed="${priv.form==='recovery'}">New recovery key</button><button class="btn danger" data-lockform="decrypt" aria-pressed="${priv.form==='decrypt'}">Turn off encryption</button></div>
      ${priv.form==='recovery'?`<form class="pform" data-privform="recovery"><p class="note">Makes a new recovery key. The old one stops working.</p>${err}<div class="tbar"><button class="btn primary" ${busy}>Make a new recovery key</button></div></form>`:''}
      ${priv.form==='decrypt'?`<form class="pform" data-privform="decrypt"><p class="note">Your data is decrypted and saved readable again, protected by your account’s file permissions only.</p>${err}<div class="tbar"><button class="btn danger" ${busy}>${priv.busy?'Decrypting…':'Turn off encryption'}</button></div></form>`:''}`;
  else {
    h+=`<p class="note">Off. Encrypts your chats, settings and attachments, with the key kept in the system keychain so Treechats still opens without asking. It protects copies of your data folder, such as backups and synced folders; it doesn’t stop someone using your account (the password lock does). The password lock turns it on too.</p>`;
    h+= lk.keychain
      ? `<form class="pform" data-privform="encrypt">${err&&priv.form==='encrypt'?err:''}<div class="tbar"><button class="btn" ${busy}>${priv.busy&&priv.form==='encrypt'?'Encrypting…':'Turn on encryption'}</button></div></form>`
      : `<p class="note">There’s no system keychain Treechats can use here${navigator.platform.startsWith('Linux')?' (it needs secret-tool from libsecret and a running keyring)':''}, so encryption comes with the password lock.</p>`;
  }
  h+=`</section>`;
  /* the password lock */
  h+=`<section class="setsec"><h3>Password lock</h3>`;
  if(priv.recovery && priv.recoveryFor!=='encrypt') h+=recBox;
  else if(!lk.password){
    h+=`<p class="note">Asks for a password whenever Treechats starts or locks, and turns on encryption${lk.on?' (already on)':''} so the data can’t be read without it. Useful if other people use this computer or your account. Coding tools can’t read your chats while it’s locked.</p>
      <form class="pform" data-privform="on">${pw('p1','Password','new-password')}${pw('p2','Password again','new-password')}
        <label class="pfield">Lock by itself<select data-lauto ${busy}>${AUTO_LOCKS.map(([v,l])=>`<option value="${v}" ${v===15?'selected':''}>${v?'After '+l+' without use':'Never'}</option>`).join('')}</select></label>
        ${priv.form==='on'||!priv.form?err:''}<p class="note">Choose something you’ll remember. If you lose both the password and the recovery key${lk.on?' you already have':' you get next'}, your chats can’t be recovered.</p>
        <div class="tbar"><button class="btn primary" ${busy}>${priv.busy&&priv.form!=='encrypt'?'Encrypting…':'Turn on the lock'}</button></div></form>`;
  } else {
    h+=`<p class="note">On. Treechats locks ${autoLockText(lk.autoLock)}.</p>
      ${setRow('Lock by itself','', `<div class="segs" role="group" aria-label="Lock by itself">${AUTO_LOCKS.map(([v,l])=>`<button class="seg" data-lautoset="${v}" aria-pressed="${lk.autoLock===v}">${l}</button>`).join('')}</div>`)}
      <div class="tbar"><button class="btn" data-locknow>Lock now</button><button class="btn" data-lockform="password" aria-pressed="${priv.form==='password'}">Change password</button><button class="btn" data-lockform="recovery" aria-pressed="${priv.form==='recovery'}">New recovery key</button><button class="btn danger" data-lockform="off" aria-pressed="${priv.form==='off'}">Turn off</button></div>`;
    if(priv.form==='password') h+=`<form class="pform" data-privform="password">${pw('cur','Current password','current-password')}${pw('p1','New password','new-password')}${pw('p2','New password again','new-password')}${err}<div class="tbar"><button class="btn primary" ${busy}>Change password</button></div></form>`;
    if(priv.form==='recovery') h+=`<form class="pform" data-privform="recovery"><p class="note">Makes a new recovery key. The old one stops working.</p>${pw('cur','Password','current-password')}${err}<div class="tbar"><button class="btn primary" ${busy}>Make a new recovery key</button></div></form>`;
    if(priv.form==='off') h+=`<form class="pform" data-privform="off"><p class="note">${lk.keychain?`Keep encryption on, with the key in ${esc(lk.keychain)} so Treechats opens without asking, or turn both off and save your data readable again.`:'Your data is decrypted and saved readable again, protected by your account’s file permissions only.'}</p>${pw('cur','Password','current-password')}${err}
      <div class="tbar">${lk.keychain?`<button class="btn primary" data-offmode="nopass" ${busy}>Turn off the lock, keep encryption</button>`:''}<button class="btn danger" data-offmode="off" ${busy}>${priv.busy?'Decrypting…':lk.keychain?'Turn off both':'Turn off the lock'}</button></div></form>`;
  }
  h+=`</section>`;
  /* the API key */
  const src=key.source==='env' ? 'From the .env file, readable only by your account.' : key.source==='keychain' ? `Kept in ${esc(key.keychain)}.` : 'None. Replies come from Claude Code and whatever it is signed in with.';
  h+=`<section class="setsec"><h3>API key</h3><p class="note">${src}${key.keychain?` Keeping it in ${esc(key.keychain)} keeps it out of plain files, backups and synced folders.`:''}</p>`;
  if(key.keychain){
    if(key.source==='env') h+=`<div class="tbar"><button class="btn" data-keymove ${busy}>Move it to ${esc(key.keychain)}</button></div><p class="note">The key is taken out of .env; the rest of the file is left as it was.</p>`;
    h+=`<form class="pform" data-privform="key"><label class="pfield">${key.source?'Replace it with':'Add a key'}<input type="password" data-keyval autocomplete="off" spellcheck="false" placeholder="sk-ant-…" ${busy}></label>${priv.form==='key'?err:''}<div class="tbar"><button class="btn" ${busy}>Save to ${esc(key.keychain)}</button>${key.source==='keychain'?`<button type="button" class="btn danger" data-keyremove ${busy}>Remove it</button>`:''}</div></form>`;
  } else h+=`<p class="note">There’s no system keychain Treechats can use here${navigator.platform.startsWith('Linux')?' (it needs secret-tool from libsecret and a running keyring)':''}${key.source==='env'?', so the key stays in .env':', so an API key goes in .env'}.</p>`;
  h+=`</section>`;
  /* the token */
  const M=L.mcp||{}, link=`${location.origin}/?token=${M.token||''}`;
  h+=`<section class="setsec"><h3>Signing in</h3><p class="note">Treechats only answers this computer, and only browsers and tools that have its token, so other accounts and programs here, and websites you visit, can’t use it. This browser is signed in, and keeps the token where only Treechats’ own page can read it. To sign in another browser, open this link in it. Coding tools get the token in the commands under System.</p>
    <div class="tbar"><button class="btn" data-copylink="${esc(link)}">Copy sign-in link</button><button class="btn" data-tokenreset>Reset the token</button></div>
    <p class="note">Reset it if the token or the link may have been seen by someone else. Other browsers are signed out, and coding tools need the new commands from System.</p></section>`;
  return h;
}
async function privCall(path, body){ return folderApi(path, body||{}); }
function privVal(sel){ const e=setEl.querySelector(sel); return e ? e.value : ''; }
async function privSubmit(kind){
  const p1=privVal('[data-pw="p1"]'), p2=privVal('[data-pw="p2"]'), cur=privVal('[data-pw="cur"]');
  const L=window.TREECHATS_LOCAL, lk=lockInfo();
  priv.err='';
  if((kind==='on' || kind==='password') && p1!==p2){ priv.err='The two passwords don’t match.'; priv.form=kind==='on'?null:kind; renderSettings(); return; }
  if((kind==='on' || kind==='password') && [...p1].length<8){ priv.err='Use a password of at least 8 characters. A few unrelated words make a strong one.'; priv.form=kind==='on'?null:kind; renderSettings(); return; }
  if(kind==='encrypt') priv.form='encrypt';
  priv.busy=true; renderSettings();
  /* the lock state as the server sees it now */
  const refresh=async()=>{ try{ const r=await fetch('/api/auth'); if(r.ok) L.lock=(await r.json()).lock; }catch(e){} };
  try{
    if(kind==='on' || kind==='encrypt'){
      await flushState();
      const auto=+privVal('[data-lauto]')||0;
      const d=await privCall('/api/vault/enable', kind==='on' ? {password:p1, autoLock:auto} : {});
      await Files.rekey(d.filesKey);
      await refresh();
      if(d.recovery){ priv.recovery=d.recovery; priv.recoveryFor=kind; }
      else toast('The password lock is on. Your recovery key stays the same.');
      priv.form=null;
    } else if(kind==='password'){ await privCall('/api/vault/password', {password:cur, next:p1}); priv.form=null; toast('Password changed.'); }
    else if(kind==='recovery'){ const d=await privCall('/api/vault/recovery', {password:cur}); priv.form=null; priv.recovery=d.recovery; priv.recoveryFor=lk.password?'on':'encrypt'; }
    else if(kind==='nopass'){ await privCall('/api/vault/nopassword', {password:cur}); await refresh(); priv.form=null; toast(`The lock is off. Your data stays encrypted, with its key in ${lk.keychain}.`); }
    else if(kind==='off' || kind==='decrypt'){
      /* attachments are made readable first, while their key still exists; if that fails they are sealed again */
      await flushState(); const was=Files.keyNow(); await Files.rekey(null);
      try{ await privCall('/api/vault/disable', {password:cur}); }catch(e){ await Files.rekey(was); throw e; }
      await refresh(); priv.form=null; toast(kind==='off' && lk.password ? 'The lock and encryption are off. Your data is saved readable again.' : 'Encryption is off. Your data is saved readable again.');
    }
    else if(kind==='key'){ priv.form='key'; L.key=await privCall('/api/key/save', {key:privVal('[data-keyval]')}); priv.form=null; toast(`Saved to ${L.key.keychain}. Reloading to use it…`); setTimeout(()=>location.reload(), 900); }
  }catch(e){ priv.err=e.message; if(kind==='key' || kind==='encrypt') priv.form=kind; if(kind==='nopass') priv.form='off'; }
  priv.busy=false;
  renderSettings();
  const f=setEl.querySelector('.perr'); if(f){ const i=f.closest('form')?.querySelector('input'); if(i) i.focus(); }
}
async function lockNow(){
  try{ await flushState(); }catch(e){}
  try{ await fetch('/api/vault/lock', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'}); }catch(e){}
  location.reload();
}
function recoveryFile(){
  const text=`Treechats recovery key\n\n${priv.recovery}\n\nIf you forget your Treechats password, choose “Use your recovery key” on the unlock screen and enter this code.\nAnyone with this code and your data folder can read your chats, so keep it somewhere safe.\n`;
  const url=URL.createObjectURL(new Blob([text], {type:'text/plain'})); const a=document.createElement('a'); a.href=url; a.download='treechats-recovery-key.txt'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
/* each section has its own Light mode / Dark mode switch: what it shows, and which mode a choice there is for */
let palMode=null, colMode=null;
const modeSwitch = (which, cur) => `<div class="segs" role="group" aria-label="Choose for">${['light','dark'].map(m=>`<button class="seg" data-modesw="${which}" data-m="${m}" aria-pressed="${cur===m}" title="Show and choose for ${m} mode. The app stays as it is.">${m==='light'?'Light mode':'Dark mode'}</button>`).join('')}</div>`;
function settingsTab(){ return SET_TABS.some(t=>t[0]===opts.setTab) ? opts.setTab : 'look'; }
function renderSettings(){
  const tab=settingsTab();
  setTabsEl.innerHTML=SET_TABS.map(([k,l])=>`<button class="settab" role="tab" data-settab="${k}" aria-selected="${k===tab}">${l}</button>`).join('');
  const mod=IS_MAC?'⌥⇧':'Alt+Shift+';
  let h='';
  if(tab==='look'){
    h+=`<section class="setsec"><h3>Text and layout</h3>
      ${setRow('Text size','',segs('textSize',Object.entries(TEXT_SIZES).map(([k,v])=>[k,v[0]]),'Text size'))}
      ${setRow('Font','System uses your device’s own font.',segs('font',Object.entries(FONTS).map(([k,v])=>[k,v[0]]),'Font'))}
      ${setRow('Density','Compact fits more prompts on screen.',segs('density',[['comfortable','Comfortable'],['compact','Compact']],'Density'))}
      ${setRow('Motion','Reduced turns off animations.',segs('motion',[['system','System'],['reduced','Reduced']],'Motion'))}
      ${setRow('Context-changed markers','A small note on a reply when something above it changed after it was written. Only you see it; Claude never does.',segs('ctxMarks',[['true','Show'],['false','Hide']],'Context-changed markers'))}
      ${setRow('Branch map in the panel','A small graph of the chat\u2019s branches under the chat list. The full map opens with M or Map.',segs('map',[['true','Show'],['false','Hide']],'Branch map in the panel'))}</section>`;
    h+=`<section class="setsec"><h3>Theme</h3>${setRow('Mode', set('theme')==='system'?`Following your device: ${resolvedMode()}`:'', segs('theme',[['system','System'],['light','Light'],['dark','Dark']],'Mode'))}</section>`;
    const mine=Object.keys(customThemes()), activeMine=!!themeFor(mget('palette', palMode || shownMode()));
    const pm=palMode || shownMode();
    h+=`<section class="setsec"><div class="colhead"><h3>Palette</h3>${modeSwitch('pal', pm)}</div><p class="note">Choosing for ${pm} mode${pm===shownMode()?'':`; the app stays in ${shownMode()} mode`}. Light and dark each keep their own palette.</p><div class="palettes">${[...Object.keys(PALETTES),...mine].map(palCard).join('')}<button class="pal newpal" data-tnew><span class="plus" aria-hidden="true">+</span><span>New theme</span></button></div>
      <div class="tbar">${activeMine&&!editingTheme?`<button class="btn" data-tedit>Edit ${esc(themeFor(mget('palette', palMode || shownMode())).name)}</button>`:''}<button class="rmore" data-timport>${importOpen?'Cancel import':'Import a theme…'}</button></div>
      ${importOpen?`<div class="timport"><textarea data-timporttext rows="3" placeholder="Paste theme code copied from Treechats" aria-label="Theme code"></textarea><button class="btn" data-timportadd>Add theme</button></div>`:''}
    </section>`;
    h+=themeEditorHTML();
    /* accent and reply colors side by side, picked the same way: swatches, with Claude's reply previewed and its contrast shown */
    /* the colors for light or dark mode: switching this changes what you see and pick here, not the app */
    { const mode=colMode || shownMode(), mpal=mget('palette', mode), t=paletteTokens(PALETTES[mpal]||themeFor(mpal) ? mpal : 'sage', mode), colMine=!!themeFor(mpal);
      /* one row per view: its swatches and color picker, a preview drawn the way that view draws replies, and the contrast */
      const rbRow=(view, label, sub)=>{
        const cur=mget(RB_KEY[view], mode), rb=replyBoxColors(mode, t, null, view), customOn=cur==='custom';
        /* in Chat, Theme means no box at all, so its swatch is drawn as an empty outline */
        const name=k=>view==='chat' && k==='theme' ? 'No box' : REPLY_BOXES[k].name;
        const sw=k=>{ const none=view==='chat' && k==='theme', c=replyBoxColors(mode, t, k, view); return `<button class="acc rbsw ${none?'rbnone':''}" data-set="${RB_KEY[view]}" data-val="${k}" aria-pressed="${cur===k}" aria-label="${name(k)}" title="${name(k)}${none?' (text on the page, as in Claude)':k==='plain'?' (the color of cards and panels)':''}" style="${none?'':`background:${c.bg};color:${c.fg};${c.rule?`box-shadow:inset 0 0 0 1.5px ${c.rule}`:''}`}">Aa</button>`; };
        const plain = view==='chat' && cur==='theme';
        return `<div class="colrow" data-rbrow="${view}"><div class="lab">${label}<small>${sub}</small></div><div class="accents">${Object.keys(REPLY_BOXES).filter(k=>k!=='custom').map(sw).join('')}<label class="acc rbsw rbcustom ${customOn?'on':''}" title="Pick a color${customOn?` (for ${mode} mode)`:''}" style="${customOn?`background:${rb.bg};color:${rb.fg}`:''}" aria-pressed="${customOn}"><input type="color" data-replycustom="${view}" value="${replyBoxColors(mode, t, 'custom', view).bg}" aria-label="Custom reply color in ${view==='chat'?'Chat':'Editor'}, ${mode} mode">${customOn?'Aa':'+'}</label></div></div>
          <div class="rbpreview reply ${view==='chat'?'rbchat':''} ${plain?'rbplain':''}" data-rbprev="${view}" style="--code-bg:${t['code-bg']};--accent:${t.accent};--line:${t.line};--muted:${t.muted};--fg:${plain?t.fg:rb.fg};--reply-fg:${plain?t.fg:rb.fg};--reply-chip:${plain?t['code-bg']:mixHex(rb.fg, rb.bg, .1)};${plain?`background:${t.bg};color:${t.fg};`:`background:${rb.bg};color:${rb.fg};`}${rb.rule&&view==='editor'?`border-left-color:${rb.rule}`:''}${view==='chat'&&!plain?`box-shadow:inset 0 0 0 ${rb.rule?'1.5px '+rb.rule:'1px var(--line)'}`:''}">${view==='editor'?`<span class="who" style="${cur==='theme'?'':`color:${rb.fg};opacity:.75`}">Claude · ${esc(REPLY_BOXES[cur]?REPLY_BOXES[cur].name:'Theme')}</span>`:''}<div class="rbody"><p>This is how a reply reads ${view==='chat'?'in Chat':'in Editor'}, with <code>inline code</code> and a <a href="#" tabindex="-1">link</a>.</p></div></div>
          <p class="note rbcontrast" data-rbct="${view}"><b>${esc(REPLY_BOXES[cur]?name(cur):'Theme')}.</b> ${plain?'Replies are text on the page, as in Claude.':rbContrastText(contrast(rb.bg, rb.fg))}</p>`;
      };
      h+=`<section class="setsec colorsec"><div class="colhead"><h3>Colors</h3>${modeSwitch('col', mode)}</div><p class="note">Choosing for ${mode} mode${mode===shownMode()?'':`; the app stays in ${shownMode()} mode`}. Light and dark each keep their own colors.</p>
        ${colMine?'':`<div class="colrow"><div class="lab">Accent<small>Buttons, the selected prompt and the main branch line.</small></div><div class="accents">${Object.entries(ACCENTS).map(([k,a])=>`<button class="acc" data-set="accent" data-val="${k}" aria-pressed="${mget('accent', mode)===k}" aria-label="${a.name}" title="${a.name}" style="background:${a[mode]}"></button>`).join('')}</div></div>`}
        ${rbRow('editor', 'Claude’s replies in Editor', 'The box replies sit in. Its text color follows it.')}
        ${rbRow('chat', 'Claude’s replies in Chat', 'Theme shows them as plain text, as in Claude. Pick a color to put them in a box.')}
</section>`; }
  } else if(tab==='saved'){
    const list=savedPrompts(), missing=SAVED_STARTERS.filter(x=>!list.some(y=>y.id===x.id));
    h+=`<section class="setsec"><h3>Saved prompts</h3><p class="note">Insert one with <b>Saved prompts</b> under the input box, or by typing <kbd>/</kbd> in an empty box. Nothing is sent until you send it. Words in {braces} are placeholders: what you’ve already typed goes into the first one, and the next is selected for you to fill in. Agents can read this list through MCP.</p>
      ${list.map((sp,i)=>`<div class="pe sp"><div class="pe-head"><input class="spname" data-spname="${i}" value="${esc(sp.name)}" aria-label="Name" maxlength="60"><button class="btn xs danger" data-spdel="${i}">Delete</button></div><textarea data-sptext="${i}" rows="${Math.min(10, Math.max(3, sp.text.split('\n').length+1))}" aria-label="${esc(sp.name)}">${esc(sp.text)}</textarea></div>`).join('')}
      <div class="tbar"><button class="btn" data-spadd>+ New saved prompt</button>${missing.length?`<button class="rmore" data-sprestore>Restore ${missing.length} starter prompt${missing.length===1?'':'s'}</button>`:''}</div></section>`;
  } else if(tab==='system'){
    h+=`<section class="setsec"><h3>Replies</h3>
      <p class="note">${AI}marks tools where Claude does the work, such as Distill or Fan out. Each use sends a request.</p>
      ${setRow('Default model','Also in the box under each prompt.',`<select data-setselect="model" aria-label="Default model">${TIERS.map(([v,l])=>`<option value="${v}" ${opts.model===v?'selected':''}>${l}</option>`).join('')}</select>`)}
      ${setRow('Replies','Chat view always shows every reply in the chat.', segs('replies',[['all','All'],['path','Context path'],['selected','Selected']],'Replies'))}
      ${setRow('Reply length','Shorten cuts long replies away from the selected prompt.', segs('replyLen',[['full','Full'],['short','Shorten']],'Reply length'))}
      ${setRow('Prompts sent to Claude','Standing instructions, merge notes, and what every '+AI+'tool asks Claude.','<button class="btn" data-setprompts>Edit prompts</button>')}
      ${setRow('Run commands','Lets /run run a command in a folder linked to a project (tests, a build, a script), so you can attach its output to a prompt. Commands run on this computer with your permissions, like in a terminal. Git diffs and reading files don’t need this.', segs('allowCommands',[['false','Off'],['true','On']],'Run commands'))}
      ${setRow('Model settings','Advanced. A system prompt, thinking, effort, temperature and reply length for a prompt and the ones after it, set from the inspector in Editor. Settings already made keep applying when this is off, and stay marked on their prompt.', segs('branchSettings',[['false','Off'],['true','On']],'Model settings'))}
      ${setRow('Quick-access bar','Which operations sit above the input box. The rest are under More.','<button class="btn" data-setquick>Choose</button>')}</section>`;
    h+=`<section class="setsec"><h3>Input</h3>
      ${setRow('Send with', set('sendKey')==='mod'?'Enter adds a new line.':'Shift+Enter adds a new line.', segs('sendKey',[['enter','Enter'],['mod',IS_MAC?'⌘ Enter':'Ctrl+Enter']],'Send with'))}
      ${setRow('Operation shortcuts',`${mod}letter runs an operation on the selected prompt.`, segs('opKeys',[['true','On'],['false','Off']],'Operation shortcuts'))}</section>`;
    if(hasServer()){
      const M=window.TREECHATS_LOCAL.mcp||{}, url=M.url||`${location.protocol}//localhost:${location.port||80}/mcp`, bearer=`Bearer ${M.token||'<token>'}`;
      const snip=(t, code, where)=>`<div class="mcpsnip"><div class="mcphead"><b>${t}</b><span class="note">${where}</span><button class="btn xs" data-copysnip="${esc(code)}">Copy</button></div><pre>${esc(code)}</pre></div>`;
      h+=`<section class="setsec"><h3>Use from coding tools (MCP)</h3><p class="note">Coding tools can read your chats, pull the exact context of a prompt (including files from linked folders, read from disk), ask side questions, and run subagents here. Treechats must be running. Each command includes Treechats’ token, which is what lets the tool in: keep it to yourself, like a password.</p>
        ${snip('Claude Code', `claude mcp add --transport http --scope user treechats ${url} --header "Authorization: ${bearer}"`, 'run once in a terminal')}
        ${snip('Cursor', JSON.stringify({mcpServers:{treechats:{url, headers:{Authorization:bearer}}}}, null, 2), '~/.cursor/mcp.json, or .cursor/mcp.json in a project')}
        ${snip('VS Code', JSON.stringify({servers:{treechats:{type:'http', url, headers:{Authorization:bearer}}}}, null, 2), '.vscode/mcp.json in a workspace, or MCP: Add Server')}
        ${snip('Codex', `[mcp_servers.treechats]\nurl = "${url}"\nhttp_headers = { Authorization = "${bearer}" }`, 'add to ~/.codex/config.toml')}
        <p class="note">Only tested with Claude Code so far; the others follow their documented formats.</p></section>`;
    }
    const nb=numberedBranches().length, ready=sampleState==='ready';
    h+=`<section class="setsec"><h3>${AI}Naming</h3>${ready?'':'<p class="note">Naming by Claude needs replies to be working: an API key in .env, or Claude Code signed in. Until then the plain names are used.</p>'}
      ${setRow('Branches', set('nameBranches')?'Claude reads a new branch\u2019s first prompt and names it, like <code>token-bucket</code>. One quick request each.':'New branches are numbered: branch-1, branch-2…', segs('nameBranches',[['true','Claude names them'],['false','Numbered']],'Branch names'))}
      ${set('nameBranches') && ready && nb ? setRow('', `${nb} numbered branch${nb===1?'':'es'} in this space.`, `<button class="btn" data-namenow>Name ${nb===1?'it':'them'} now</button>`) : ''}
      ${setRow('Chats', set('nameConvs')?'After the first reply, Claude writes a short title.':'Titled with the first prompt. Rename any time.', segs('nameConvs',[['true','Claude titles them'],['false','First prompt']],'Chat titles'))}
      ${setRow('Projects', set('nameSpaces')?'A new project is named after its first chat.':'New projects are called New project. Rename any time.', segs('nameSpaces',[['true','Claude names them'],['false','New project']],'Project names'))}</section>`;
    const st=spaceIds().reduce((a,id)=>{ const x=spaceStats(DB.spaces[id].tree); a.c+=x.convs; a.p+=x.prompts; return a; },{c:0,p:0});
    h+=`<section class="setsec"><h3>Storage</h3><p class="note">Everything is saved on this computer${hasServer()&&window.TREECHATS_LOCAL.dataDir?` in ${esc(window.TREECHATS_LOCAL.dataDir)}`:''}${lockInfo().on?', encrypted':''}: ${spaceIds().length} project${spaceIds().length===1?'':'s'}, ${st.c} chat${st.c===1?'':'s'}, ${st.p} prompt${st.p===1?'':'s'}. Use Import / export to move it elsewhere.</p>
      ${setRow('Reset settings','Puts Personalization and System back to their defaults. Your chats and prompts aren’t touched.','<button class="btn danger" data-setreset>Reset settings</button>')}</section>`;
  } else if(tab==='privacy'){
    h+=privacyHTML();
  } else if(tab==='prompts'){
    const custom=Object.keys(PROMPTS).filter(k=>promptText(k)!==PROMPTS[k].def).length;
    h+=`<section class="setsec"><p class="note">Every piece of text Treechats sends to Claude on your behalf. Words in {braces} are filled in when it\u2019s sent; if you remove one, that material is added at the end instead. Edits apply from the next request.</p>
      ${setRow('Before a ✦ tool sends its request', 'For summaries (Include as, Squash, Reroot), Distill and Fan out. Show me first opens the instruction so you can change it for that one use. Shift-click a ✦ button to see it once either way. Review always asks; naming and checks never stop to ask.', segs('aiReview',[['send','Send it right away'],['review','Show me first']],'Before a ✦ tool sends its request'))}</section>`;
    for(const [g, title, note] of PROMPT_GROUPS){
      const ks=Object.keys(PROMPTS).filter(k=>PROMPTS[k].group===g); if(!ks.length) continue;
      h+=`<section class="setsec"><h3>${title}</h3>${note?`<p class="note">${note}</p>`:''}<div class="pes">${ks.map(k=>promptEditor(k,'-set')).join('')}</div></section>`;
    }
    h+=`<section class="setsec">${setRow('Reset prompts', custom?`${custom} prompt${custom===1?' is':'s are'} changed from the default.`:'All prompts are the defaults.', `<button class="btn" data-resetprompts ${custom?'':'disabled'}>Reset all prompts</button>`)}</section>`;
  } else if(tab==='ops'){
    h+=`<section class="setsec"><div id="opsCard"></div></section>`;
  } else if(tab==='bar'){
    const on=quickList(), off=Object.keys(OPS).filter(k=>pinnable(k) && !on.includes(k)), grp=(ks, f)=>groupedOps(ks).map(([g,l,gk])=>`<li class="qgrp" role="presentation">${esc(l)}</li>${gk.map(f).join('')}`).join('');
    const row=(k,i,inBar)=>`<li class="qrow ${inBar?'on':''}"><label class="chk"><input type="checkbox" data-qtoggle="${k}" ${inBar?'checked':''}> <span class="${OPS[k].danger?'danger':''}">${esc(OPS[k].label)}</span></label><span class="qhint">${esc(OPS[k].hint)}</span>${opts.opKeys===false?'':`<kbd>${kk(OPS[k].key)}</kbd>`}
      ${inBar?`<span class="qmove"><button class="btn xs" data-qmove="${k}" data-dir="-1" ${i===0?'disabled':''} aria-label="Move ${esc(OPS[k].label)} left">↑</button><button class="btn xs" data-qmove="${k}" data-dir="1" ${i===on.length-1?'disabled':''} aria-label="Move ${esc(OPS[k].label)} right">↓</button></span>`:'<span class="qmove"></span>'}</li>`;
    h+=`<section class="setsec"><h3>In the bar</h3><p class="note">These sit above the input box, by group (Branch, Merge, Copy &amp; move, Remove), in this order within each. Include as… and Regenerate aren’t here: they sit under the prompt and its reply. Some only show on prompts they apply to, like Compare on a prompt with two or more follow-ups.</p><ul class="qlist">${grp(on, k=>row(k,on.indexOf(k),true))||'<li class="note">Nothing yet. Everything is under More.</li>'}</ul></section>`;
    h+=`<section class="setsec"><h3>Under More</h3><p class="note">Still one click away under <b>More ▾</b> at the end of the bar, in Commands (${IS_MAC?'⌘K':'Ctrl+K'}), on their shortcuts, and in Operations &amp; prompts.</p><ul class="qlist">${grp(off, k=>row(k,0,false))}</ul>
      <div class="bar"><button class="btn" data-qreset ${Array.isArray(opts.quick)?'':'disabled'}>Reset to the default</button></div></section>`;
  } else {
    const k=(a,b)=>`<dt>${a}</dt><dd>${b}</dd>`, kb=x=>`<kbd>${x}</kbd>`;
    h+=`<section class="setsec"><h3>Moving around</h3><dl class="keys">${k(kb('↑')+' '+kb('↓'),'Select the previous or next prompt')}${k(kb('←')+' '+kb('→'),'Switch between reply versions')}${k(kb(IS_MAC?'⌘K':'Ctrl+K'),'Open commands: run anything by name')}${k(kb('/'),'Search chats')}${k(kb('Esc'),'Cancel, or deselect the prompt')}${k(kb(IS_MAC?'⌘Z':'Ctrl+Z')+' '+kb(IS_MAC?'⌘⇧Z':'Ctrl+Shift+Z'),'Undo and redo')}</dl></section>`;
    h+=`<section class="setsec"><h3>Writing</h3><dl class="keys">${k(kb(sendKbd()),'Send')}${k(kb(set('sendKey')==='mod'?'↵':(IS_MAC?'⇧↵':'Shift ↵')),'New line')}${k(kb(IS_MAC?'⌘':'Ctrl')+' / '+kb(IS_MAC?'⇧':'Shift')+' + click','Also reply to another prompt')}</dl></section>`;
    h+=`<section class="setsec"><h3>Operations${opts.opKeys===false?' (off)':''}</h3><dl class="keys">${Object.values(OPS).map(o=>k(kb(kk(o.key)),o.label.replace('…',''))).join('')}</dl></section>`;
  }
  setBodyEl.innerHTML=h;
  if(tab==='ops') renderOpsCard();
}
function openSettings(tab){
  if(tab) opts.setTab=tab;
  setReturn=document.activeElement; closeMenu && menuEl && closeMenu();
  renderSettings(); setEl.hidden=false; document.body.style.overflow='hidden';
  const t=setTabsEl.querySelector('[aria-selected="true"]'); if(t) t.focus({preventScroll:true});
}
function closeSettings(){ palMode=null; colMode=null; if(editingTheme||previewMode||importOpen){ editingTheme=null; previewMode=null; importOpen=false; applyAppearance(); } setEl.hidden=true; document.body.style.overflow=''; if(setReturn && setReturn.focus) setReturn.focus({preventScroll:true}); }
function trapTab(e, root=setEl){
  const f=[...root.querySelectorAll('button,select,input,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled);
  if(!f.length) return; const i=f.indexOf(document.activeElement);
  if(e.shiftKey && i<=0){ e.preventDefault(); f[f.length-1].focus(); } else if(!e.shiftKey && i===f.length-1){ e.preventDefault(); f[0].focus(); }
}
function afterSetting(key){
  save();
  if(['theme','palette','accent','textSize','font','density','motion','replyBox','replyBoxChat'].includes(key)){ applyAppearance(); placeAside(); }
  if(key==='replies'){ openReplies.clear(); renderTree(); }
  if(key==='replyLen'){ fullReplies.clear(); renderTree(); }
  if(key==='sendKey' || key==='model' || key==='ctxMarks'){ renderTree(); }
  if(key==='branchSettings'){ bsetFor=null; renderCtx(); }
  if(key==='opKeys' || key==='sendKey') renderOpsCard();
  if(key==='map') drawMap();
  if(['theme','palette','accent','textSize','font','density'].includes(key)) scheduleMap();
}
function afterQuick(){ save(); renderSettings(); renderOpsCard(); if(sel!=null) renderTree(); }
function refocus(sel){ const el=setEl.querySelector(sel); if(el) el.focus({preventScroll:true}); }
document.getElementById('settingsBtn').addEventListener('click', ()=>openSettings());
document.getElementById('paletteBtn').addEventListener('click', ()=>openPalette());
if(!IS_MAC) document.getElementById('palKbd').textContent='Ctrl K';
cmpEl().addEventListener('click', e=>{
  const c=x=>e.target.closest(x);
  if(e.target===cmpEl() || c('[data-cmpclose]')){ closeCompare(); return; }
  const o=c('[data-copen]'); if(o){ const id=+o.dataset.copen; closeCompare(); select(id); return; }
  const m=c('[data-cmain]'); if(m){ promote(+m.dataset.cmain); renderCompare(); return; }
  const pr=c('[data-cprune]'); if(pr){ run('prune', +pr.dataset.cprune); renderCompare(); return; }
  const g=c('[data-cget]'); if(g){ generate(+g.dataset.cget); return; }
  if(c('[data-cgetall]')){ wantReplies(cmpList().filter(k=>!k.reply).map(k=>k.id)); return; }
  const cs=c('[data-cstop]'); if(cs){ stopReply(+cs.dataset.cstop); renderCompare(); return; }
  if(c('[data-cstopall]')){ for(const k of cmpList()) stopReply(k.id); renderCompare(); return; }
  if(c('[data-judge]')){ runJudge(); return; }
  if(c('[data-combine]') || c('[data-combagain]')){ runCombine(); return; }
  if(c('[data-combdiscard]')){ cmpTool.combine=null; renderCompare(); return; }
  if(c('[data-combadd]')){ addCombinedDraft(); return; }
});
palEl().addEventListener('click', e=>{ if(e.target===palEl()){ closePalette(); return; } const o=e.target.closest('[data-pal]'); if(o) runPalette(+o.dataset.pal); });
palEl().addEventListener('mousemove', e=>{ const o=e.target.closest('[data-pal]'); if(o && +o.dataset.pal!==palIdx){ palIdx=+o.dataset.pal; for(const x of palEl().querySelectorAll('.palo')) x.classList.toggle('on', +x.dataset.pal===palIdx); } });
document.getElementById('palInput').addEventListener('input', ()=>{ palIdx=0; renderPalette(); });
document.getElementById('palInput').addEventListener('keydown', e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); if(!palItems.length) return; palIdx=(palIdx+(e.key==='ArrowDown'?1:-1)+palItems.length)%palItems.length; renderPalette(); return; }
  if(e.key==='Enter' && !e.isComposing){ e.preventDefault(); e.stopPropagation(); runPalette(palIdx); return; }
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closePalette(); return; }
  if(e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); }
});
setEl.addEventListener('submit', e=>{ const f=e.target.closest('[data-privform]'); if(!f) return; e.preventDefault(); if(priv.busy) return;
  /* turning the lock off: which button was used (Enter in the password field means the first one) */
  let kind=f.dataset.privform; if(kind==='off'){ const b=e.submitter && e.submitter.dataset.offmode ? e.submitter : f.querySelector('[data-offmode]'); kind=b ? b.dataset.offmode : 'off'; }
  privSubmit(kind); });
setEl.addEventListener('click', e=>{
  if(!setEl.contains(e.target)) return;
  const c2=q=>e.target.closest(q);
  if(e.target===setEl || e.target.closest('[data-setclose]')){ closeSettings(); return; }
  const t=e.target.closest('[data-settab]'); if(t){ opts.setTab=t.dataset.settab; save(); renderSettings(); setBodyEl.scrollTop=0; refocus(`[data-settab="${t.dataset.settab}"]`); return; }
  const b=e.target.closest('[data-set]');
  if(b){ const key=b.dataset.set; let v=b.dataset.val; if(['opKeys','map','ctxMarks','branchSettings','allowCommands','nameBranches','nameConvs','nameSpaces'].includes(key)) v = v==='true';
    if(key==='palette' && editingTheme && v!==editingTheme){ editingTheme=null; previewMode=null; }
    /* a palette, accent or reply color is for the mode its section's switch shows, and only that mode */
    if(PER_MODE.includes(key)) mput(key, v, key==='palette' ? (palMode || shownMode()) : (colMode || shownMode()));
    else opts[key]=v;
    if(key==='theme'){ previewMode=null; if(editingTheme){ editMode=resolvedMode(); previewMode=editMode; } } afterSetting(key); renderSettings(); refocus(`[data-set="${key}"][data-val="${b.dataset.val}"]`); return; }
  if(c2('[data-locknow]')){ lockNow(); return; }
  const lf=c2('[data-lockform]'); if(lf){ priv.form = priv.form===lf.dataset.lockform ? null : lf.dataset.lockform; priv.err=''; renderSettings(); const i=setEl.querySelector('.pform input'); if(i) i.focus(); return; }
  const la=c2('[data-lautoset]'); if(la){ privCall('/api/vault/settings', {autoLock:+la.dataset.lautoset}).then(d=>{ window.TREECHATS_LOCAL.lock=d.lock; renderSettings(); }).catch(err=>toast(err.message)); return; }
  if(c2('[data-reccopy]')){ copyText(priv.recovery, true).then(ok=>{ if(ok) toast('Copied. Paste it somewhere safe, then clear your clipboard.'); }); return; }
  if(c2('[data-recsave]')){ recoveryFile(); return; }
  if(c2('[data-recdone]')){ priv.recovery=null; priv.recoveryFor=null; renderSettings(); return; }
  if(c2('[data-keymove]')){ priv.busy=true; renderSettings(); privCall('/api/key/move').then(k=>{ window.TREECHATS_LOCAL.key=k; toast(`Moved to ${k.keychain}.`); }).catch(err=>toast(err.message)).finally(()=>{ priv.busy=false; renderSettings(); }); return; }
  if(c2('[data-keyremove]')){ privCall('/api/key/remove').then(k=>{ window.TREECHATS_LOCAL.key=k; toast('Removed. Reloading…'); setTimeout(()=>location.reload(), 900); }).catch(err=>toast(err.message)); return; }
  if(c2('[data-tokenreset]')){ privCall('/api/auth/reset').then(d=>{ if(window.TREECHATS_KEEP_TOKEN) window.TREECHATS_KEEP_TOKEN(d.token); window.TREECHATS_LOCAL.mcp=d.mcp; renderSettings(); toast('New token made. Add Treechats to your coding tools again with the commands under System.'); }).catch(err=>toast(err.message)); return; }
  const cl=c2('[data-copylink]'); if(cl){ copyText(cl.dataset.copylink, true).then(ok=>{ if(ok) toast('Copied. Open it in the other browser on this computer.'); }); return; }
  const cs=e.target.closest('[data-copysnip]'); if(cs){ copyText(cs.dataset.copysnip, true).then(ok=>{ if(ok) toast('Copied.'); }); return; }
  if(e.target.closest('[data-namenow]')){ for(const rid of numberedBranches()) queueBranchName(rid, true); renderSettings(); toast('Claude is naming them. They update as each name arrives.'); return; }
  const qt=e.target.closest('[data-qtoggle]'); if(qt){ const k=qt.dataset.qtoggle, list=quickList().slice(); const i=list.indexOf(k); if(i>=0) list.splice(i,1); else list.push(k); opts.quick=list; afterQuick(); refocus(`[data-qtoggle="${k}"]`); return; }
  const qm=e.target.closest('[data-qmove]'); if(qm){ const k=qm.dataset.qmove, d=+qm.dataset.dir, list=quickList().slice(), i=list.indexOf(k), j=i+d; if(i<0||j<0||j>=list.length) return; [list[i],list[j]]=[list[j],list[i]]; opts.quick=list; afterQuick(); const b=setEl.querySelector(`[data-qmove="${k}"][data-dir="${d}"]`); (b && !b.disabled ? b : setEl.querySelector(`[data-qmove="${k}"]:not(:disabled)`))?.focus({preventScroll:true}); return; }
  if(e.target.closest('[data-qreset]')){ delete opts.quick; afterQuick(); refocus('[data-settab="bar"]'); toast('The quick-access bar is back to its default.'); return; }
  if(e.target.closest('[data-setquick]')){ opts.setTab='bar'; save(); renderSettings(); refocus('[data-settab="bar"]'); return; }
  const spd=e.target.closest('[data-spdel]'); if(spd){ const l=savedPrompts().slice(); l.splice(+spd.dataset.spdel,1); opts.saved=l; save(); renderSettings(); return; }
  if(e.target.closest('[data-spadd]')){ opts.saved=[...savedPrompts(), {id:'u'+Date.now().toString(36), name:'New prompt', text:''}]; save(); renderSettings(); const t=setEl.querySelector(`[data-sptext="${opts.saved.length-1}"]`); if(t) t.focus(); return; }
  if(e.target.closest('[data-sprestore]')){ opts.saved=[...savedPrompts(), ...SAVED_STARTERS.filter(x=>!savedPrompts().some(y=>y.id===x.id)).map(clone)]; save(); renderSettings(); return; }
  if(e.target.closest('[data-setprompts]')){ opts.setTab='prompts'; save(); renderSettings(); setBodyEl.scrollTop=0; refocus('[data-settab="prompts"]'); return; }
  const pr=e.target.closest('[data-reset]'); if(pr){ resetPrompt(pr.dataset.reset); return; }
  if(e.target.closest('[data-resetprompts]')){ opts.prompts={}; syncPromptFields(); renderSettings(); refocus('[data-settab="prompts"]'); toast('Every prompt is back to its default.'); return; }
  if(e.target.closest('[data-setreset]')){
    for(const k of Object.keys(SET_DEFAULTS)) delete opts[k];
    for(const k of Object.keys(opts)) if(k.includes('@')) delete opts[k];
    opts.replies='selected'; opts.model='quick';
    save(); applyAppearance(); placeAside(); renderTree(); renderOpsCard(); renderSettings(); refocus('[data-setreset]');
    toast('Settings are back to their defaults.'); return;
  }
});
setEl.addEventListener('change', e=>{
  if(e.target.dataset.setselect==='model'){ opts.model=e.target.value; afterSetting('model'); }
  if(e.target.dataset.replycustom!=null){ save(); renderSettings(); return; }
  const d=e.target.dataset;
  if(d.thex!=null){ if(isHex(e.target.value)) setThemeColor(d.thex, normHex(e.target.value), e.target); else e.target.value=themeFor(editingTheme)[editMode][d.thex]||autoColors(themeFor(editingTheme)[editMode])[d.thex]; save(); }
  if(d.tc!=null || d.tname!=null) save();
});
setEl.addEventListener('input', e=>{
  const d=e.target.dataset;
  if(d.replycustom!=null){
    /* updated in place, so the color picker stays open while you drag */
    const mode=colMode || shownMode(), view=d.replycustom==='chat'?'chat':'editor';
    opts[RB_CUSTOM[view]]=Object.assign({}, opts[RB_CUSTOM[view]], {[mode]:normHex(e.target.value)}); mput(RB_KEY[view], 'custom', mode); applyAppearance();
    const row=setEl.querySelector(`[data-rbrow="${view}"]`), lb=e.target.closest('.rbcustom');
    if(row) for(const x of row.querySelectorAll('.rbsw')) x.setAttribute('aria-pressed', x===lb);
    if(lb) lb.classList.add('on');
    const mp=mget('palette', mode), t=paletteTokens(PALETTES[mp]||themeFor(mp) ? mp : 'sage', mode), rb=replyBoxColors(mode, t, null, view);
    const pv=setEl.querySelector(`[data-rbprev="${view}"]`), ct=setEl.querySelector(`[data-rbct="${view}"]`);
    if(pv){ pv.classList.remove('rbplain'); pv.style.background=rb.bg; pv.style.color=rb.fg; if(view==='chat') pv.style.boxShadow='inset 0 0 0 1px var(--line)'; }
    if(lb){ lb.style.background=rb.bg; lb.style.color=rb.fg; lb.lastChild.textContent='Aa'; }
    if(ct) ct.innerHTML='<b>Custom.</b> '+rbContrastText(contrast(rb.bg, rb.fg));
    return;
  }
  if(d.prompt!=null){ setPrompt(d.prompt, e.target.value, e.target); return; }
  if(d.spname!=null){ const sp=savedPrompts()[+d.spname]; if(sp){ sp.name=e.target.value.trim()||'Untitled'; save(); } return; }
  if(d.sptext!=null){ const sp=savedPrompts()[+d.sptext]; if(sp){ sp.text=e.target.value; save(); } return; }
  if(d.tc!=null) setThemeColor(d.tc, normHex(e.target.value), e.target);
  if(d.tname!=null){ const th=themeFor(editingTheme); if(th){ th.name=e.target.value.trim()||'Untitled'; refreshPalCard(editingTheme); } }
});
setEl.addEventListener('toggle', e=>{ if(e.target.dataset && e.target.dataset.openkey==='theme-more'){ opts.open['theme-more']=e.target.open; save(); } }, true);
function refreshPalCard(id){ const old=setEl.querySelector(`.pal[data-val="${id}"]`); if(old) old.outerHTML=palCard(id); }
function setThemeColor(key, v, src){
  const th=themeFor(editingTheme); if(!th) return;
  th[editMode][key]=v;
  for(const el of setEl.querySelectorAll(`[data-tc="${key}"],[data-thex="${key}"]`)) if(el!==src) el.value = el.type==='color' ? v.toLowerCase() : v;
  if(THEME_MORE.some(x=>x[0]===key)){ const sw=setEl.querySelector(`[data-tc="${key}"]`).closest('.sw'); if(!sw.querySelector('[data-tauto]')){ sw.querySelector('.swl em')?.remove(); sw.insertAdjacentHTML('beforeend', `<button class="rmore" data-tauto="${key}" title="Work this color out from the others again">Auto</button>`); } }
  // colors still on auto follow the core colors
  const auto=autoColors(th[editMode]);
  for(const [k] of THEME_MORE) if(!th[editMode][k]) for(const el of setEl.querySelectorAll(`[data-tc="${k}"],[data-thex="${k}"]`)) el.value = el.type==='color' ? auto[k].toLowerCase() : auto[k];
  applyAppearance(); refreshPalCard(editingTheme);
  const c=setEl.querySelector('[data-tcontrast]'); if(c) c.innerHTML=contrastHTML();
}
function newThemeFrom(pid, name){
  const id='t'+Date.now().toString(36), src=themeFor(pid);
  const pick=(m)=>{ if(src) return Object.assign({}, src[m]); const t=builtinTokens(pid, mget('accent', m), m); return {bg:t.bg, side:t.side, surface:t.surface, fg:t.fg, accent:t.accent}; };
  customThemes()[id]={name, light:pick('light'), dark:pick('dark')};
  return id;
}
function editTheme(id){ editingTheme=id; editMode=resolvedMode(); previewMode=editMode; mput('palette', id); save(); applyAppearance(); renderSettings(); const ed=setEl.querySelector('[data-ted]'); if(ed){ ed.scrollIntoView({block:'start'}); const n=ed.querySelector('[data-tname]'); n.focus({preventScroll:true}); n.select(); } }
function themeName(base){ const used=new Set(Object.values(customThemes()).map(t=>t.name)); if(!used.has(base)) return base; let k=2; while(used.has(`${base} ${k}`)) k++; return `${base} ${k}`; }
function parseThemeCode(txt){
  let d; try{ d=JSON.parse(txt); }catch(e){ return null; }
  if(d && d.treechatsTheme) d=d.treechatsTheme;
  if(!d || typeof d!=='object') return null;
  const mode=m=>{ const o=d[m]; if(!o || !THEME_CORE.every(([k])=>isHex(o[k]))) return null; const r={}; for(const [k] of [...THEME_CORE,...THEME_MORE]) if(isHex(o[k])) r[k]=normHex(o[k]); return r; };
  const light=mode('light'), dark=mode('dark'); if(!light||!dark) return null;
  return {name:String(d.name||'Imported theme').slice(0,40), light, dark};
}
setEl.addEventListener('click', e=>{
  const c=x=>e.target.closest(x);
  if(c('[data-tnew]')){ const cp=mget('palette', palMode || shownMode()), base=themeFor(cp)?cp:(PALETTES[cp]?cp:'sage'); const id=newThemeFrom(base, themeName('My theme')); editTheme(id); return; }
  if(c('[data-tedit]')){ editTheme(mget('palette', palMode || shownMode())); return; }
  if(c('[data-tdone]')){ editingTheme=null; previewMode=null; save(); applyAppearance(); renderSettings(); refocus(`.pal[data-val="${set('palette')}"]`); return; }
  const ms=c('[data-modesw]'); if(ms){ if(ms.dataset.modesw==='pal') palMode=ms.dataset.m; else colMode=ms.dataset.m; renderSettings(); refocus(`[data-modesw="${ms.dataset.modesw}"][data-m="${ms.dataset.m}"]`); return; }
  const m=c('[data-tmode]'); if(m){ editMode=m.dataset.tmode; previewMode=editMode; applyAppearance(); renderSettings(); refocus(`[data-tmode="${editMode}"]`); return; }
  const au=c('[data-tauto]'); if(au){ const th=themeFor(editingTheme); delete th[editMode][au.dataset.tauto]; save(); applyAppearance(); renderSettings(); return; }
  if(c('[data-tcopy]')){ const th=themeFor(editingTheme); copyText(JSON.stringify({treechatsTheme:th})); return; }
  if(c('[data-tdup]')){ const th=themeFor(editingTheme); const id=newThemeFrom(editingTheme, themeName(th.name+' copy')); editTheme(id); return; }
  if(c('[data-tdel]')){
    const id=editingTheme, th=themeFor(id), was=clone(th);
    delete customThemes()[id]; editingTheme=null; previewMode=null; for(const m of ['light','dark']) if(mget('palette', m)===id) mput('palette', 'sage', m); if(opts.palette===id) opts.palette='sage'; save(); applyAppearance(); renderSettings();
    toast(`Deleted ${th.name}`, false, {label:'Undo', fn:()=>{ customThemes()[id]=was; mput('palette', id); save(); applyAppearance(); if(!setEl.hidden) renderSettings(); }});
    return;
  }
  if(c('[data-timport]')){ importOpen=!importOpen; renderSettings(); if(importOpen) refocus('[data-timporttext]'); else refocus('[data-timport]'); return; }
  if(c('[data-timportadd]')){
    const th=parseThemeCode(setEl.querySelector('[data-timporttext]').value);
    if(!th){ toast('That isn\u2019t theme code from Treechats. Use Copy theme code in a theme\u2019s editor.'); return; }
    th.name=themeName(th.name); const id='t'+Date.now().toString(36); customThemes()[id]=th; importOpen=false; mput('palette', id); save(); applyAppearance(); renderSettings(); refocus(`.pal[data-val="${id}"]`);
    toast(`Added ${th.name}`); return;
  }
}, true);
