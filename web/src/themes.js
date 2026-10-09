/* Themes and colors: palettes, your own themes, reply boxes, and contrast. */

/* ---- Colors ----
   Every theme, built in or your own, resolves to the same set of CSS tokens for the current mode. */
const hexRgb=h=>{ h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); const n=parseInt(h,16); return [n>>16&255, n>>8&255, n&255]; };
const rgbHex=c=>'#'+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('').toUpperCase();
const mixHex=(a,b,w)=>{ const x=hexRgb(a), y=hexRgb(b); return rgbHex(x.map((v,i)=>v*w+y[i]*(1-w))); };
const lum=h=>{ const [r,g,b]=hexRgb(h).map(v=>{ v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }); return .2126*r+.7152*g+.0722*b; };
const contrast=(a,b)=>{ const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
const isHex=v=>/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v||'').trim());
const normHex=v=>{ v=String(v).trim().replace('#',''); if(v.length===3) v=v.split('').map(c=>c+c).join(''); return '#'+v.toUpperCase(); };
const EXTRA={
  light:{merge:'#9A5B00', danger:'#B8342F', summary:'#6B4FB3', l1:'#0E8A6A', l2:'#B86A00', l3:'#8A3FB5', 'reply-rule':'#8A6A2E', shadow:'rgba(20,30,25,.16)'},
  dark:{merge:'#E3A64E', danger:'#F07A70', summary:'#B59DF2', l1:'#4CC9A2', l2:'#E3A64E', l3:'#C58BEB', 'reply-rule':'#D2B173', shadow:'rgba(0,0,0,.5)'}
};
const THEME_CORE=[['bg','Background'],['side','Side panels'],['surface','Cards'],['fg','Text'],['accent','Accent']];
const THEME_MORE=[['muted','Secondary text'],['line','Borders'],['reply-bg','Reply background'],['code-bg','Code background'],['merge','Merges'],['danger','Delete actions'],['summary','Summaries'],['l1','Branch line 2'],['l2','Branch line 3'],['l3','Branch line 4']];
const TOKEN_KEYS=['bg','surface','fg','muted','line','side','panel','reply-bg','code-bg','accent','accent-soft','on-accent','l0','l1','l2','l3','merge','merge-soft','danger','danger-soft','summary','summary-soft','reply-rule','shadow'];
/* the colors a custom theme doesn't set itself are worked out from the five it does */
function autoColors(b){
  const dark=lum(b.bg)<.2, X=EXTRA[dark?'dark':'light'];
  return {muted:mixHex(b.fg,b.surface,.62), line:mixHex(b.fg,b.surface,.17), 'reply-bg':mixHex(b.fg,b.surface,.045), 'code-bg':mixHex(b.fg,b.bg,.07),
    merge:X.merge, danger:X.danger, summary:X.summary, l1:X.l1, l2:X.l2, l3:X.l3};
}
function customTokens(b){
  const dark=lum(b.bg)<.2, X=EXTRA[dark?'dark':'light'], c=Object.assign(autoColors(b), b), t={};
  for(const k of ['bg','surface','fg','side','accent','muted','line','reply-bg','code-bg','merge','danger','summary','l1','l2','l3']) t[k]=c[k];
  t.panel=mixHex(c.side,c.bg,.5); t.l0=c.accent;
  t['accent-soft']=mixHex(c.accent,c.surface,dark?.22:.13);
  t['on-accent']=contrast('#FFFFFF',c.accent)>=contrast('#111418',c.accent)?'#FFFFFF':'#111418';
  for(const k of ['merge','danger','summary']) t[k+'-soft']=mixHex(c[k],c.surface,dark?.2:.15);
  t['reply-rule']=mixHex(c.fg,c.surface,.45); t.shadow=X.shadow;
  return t;
}
function builtinTokens(pid, accent, mode){
  const pal=(PALETTES[pid]||PALETTES.sage)[mode], X=EXTRA[mode], t={};
  NEUTRAL_KEYS.forEach((k,i)=>t[k]=pal[i]);
  const a=(ACCENTS[accent]||ACCENTS.blue)[mode], blue=ACCENTS.blue[mode];
  Object.assign(t, {accent:a, l0:a, 'accent-soft':mixHex(a,pal[1],mode==='dark'?.22:.13), 'on-accent':mode==='dark'?pal[0]:'#FFFFFF',
    merge:X.merge, danger:X.danger, summary:X.summary, l2:X.l2, 'reply-rule':X['reply-rule'], shadow:X.shadow,
    l1: accent==='green' ? blue : X.l1, l3: accent==='violet' ? blue : X.l3}); // keep the other lanes distinct from the accent
  for(const k of ['merge','danger','summary']) t[k+'-soft']=mixHex(t[k],pal[1],mode==='dark'?.2:.15);
  return t;
}
const customThemes=()=>opts.themes||(opts.themes={});
const themeFor=pid=>customThemes()[pid];
const paletteTokens=(pid, mode)=> themeFor(pid) ? customTokens(themeFor(pid)[mode]) : builtinTokens(pid, mget('accent', mode), mode);
let previewMode=null, editingTheme=null, editMode='light', importOpen=false;
const shownMode=()=>previewMode||resolvedMode();
/* Claude's reply box, set apart from themes so it can be made easy to read whatever the theme. Each choice resolves
   per mode; the reply's text color follows the box, so it always contrasts with it. */
const REPLY_BOXES={
  theme:{name:'Theme'},
  plain:{name:'Card', light:t=>t.surface, dark:t=>t.surface},
  gray:{name:'Gray', light:'#EFF1F3', dark:'#1D2024'},
  blue:{name:'Blue', light:'#E9F0FC', dark:'#172133'},
  green:{name:'Green', light:'#E7F3EC', dark:'#14231B'},
  contrast:{name:'High contrast', light:'#FFFFFF', dark:'#000000', fg:{light:'#000000', dark:'#FFFFFF'}, rule:{light:'#000000', dark:'#FFFFFF'}},
  custom:{name:'Custom'},
};
const rbContrastText = cr => `Text contrast ${cr.toFixed(1)}:1, ${cr>=7?'easy to read (meets WCAG AAA)':cr>=4.5?'readable (meets WCAG AA)':'hard to read: choose a lighter or darker color'}.`;
/* Editor and Chat each have their own reply color: Editor's replies sit in a box by default, Chat's are plain text on
   the page (as in Claude) unless you pick a color for them */
const RB_KEY={editor:'replyBox', chat:'replyBoxChat'}, RB_CUSTOM={editor:'replyCustom', chat:'replyCustomChat'};
const viewNow = () => opts.simple ? 'chat' : 'editor';
function replyBoxColors(mode, t, key, view=viewNow()){
  const k=REPLY_BOXES[key||mget(RB_KEY[view], mode)] ? (key||mget(RB_KEY[view], mode)) : 'theme';
  if(k==='theme') return {bg:t['reply-bg'], fg:t.fg, rule:null, custom:false};
  const b=REPLY_BOXES[k], cu=opts[RB_CUSTOM[view]];
  let bg = k==='custom' ? ((cu && cu[mode]) || t['reply-bg']) : typeof b[mode]==='function' ? b[mode](t) : b[mode];
  if(!isHex(bg)) bg=t['reply-bg'];
  /* the theme's text color if it reads well on the box, else black or white, whichever reads better */
  const fg = b.fg ? b.fg[mode] : contrast(bg, t.fg)>=7 ? t.fg : contrast(bg, '#111111')>=contrast(bg, '#FFFFFF') ? '#111111' : '#FFFFFF';
  return {bg:normHex(bg), fg, rule: b.rule ? b.rule[mode] : null, custom:k==='custom'};
}
function applyAppearance(){
  const root=document.documentElement, mode=shownMode();
  if(set('theme')==='system' && !previewMode) root.removeAttribute('data-theme'); else root.dataset.theme=mode;
  const pid = PALETTES[set('palette')]||themeFor(set('palette')) ? set('palette') : 'sage';
  const t=paletteTokens(pid, mode);
  for(const k of TOKEN_KEYS) root.style.setProperty('--'+k, t[k]);
  const view=viewNow(), rbKey=set(RB_KEY[view]), rb=replyBoxColors(mode, t, null, view);
  const RB_VARS=['--reply-accent','--reply-fg','--reply-muted','--reply-line','--reply-chip','--page-fg','--page-muted','--page-line'];
  if(rbKey!=='theme'){
    root.style.setProperty('--reply-bg', rb.bg); if(rb.rule) root.style.setProperty('--reply-rule', rb.rule);
    /* inside the box, quiet text, borders and inline code are mixed from the box's own colors; code blocks keep the theme's */
    const v={'--reply-fg':rb.fg, '--reply-muted':mixHex(rb.fg, rb.bg, .62), '--reply-line':mixHex(rb.fg, rb.bg, .22), '--reply-chip':mixHex(rb.fg, rb.bg, .1), '--reply-accent':[t.accent, mixHex(t.accent,'#FFFFFF',.45), mixHex(t.accent,'#000000',.55)].sort((a,b)=>contrast(b, rb.bg)-contrast(a, rb.bg))[0], '--page-fg':t.fg, '--page-muted':t.muted, '--page-line':t.line};
    for(const [k,x] of Object.entries(v)) root.style.setProperty(k, x);
  } else for(const k of RB_VARS) root.style.removeProperty(k);
  /* the view on screen uses its own reply color; with Theme, Chat view draws replies without a box */
  root.classList.toggle('rbox', rbKey!=='theme');
  root.classList.toggle('rbrule', rbKey!=='theme' && !!rb.rule);
  root.style.colorScheme=mode;
  root.style.fontSize=(TEXT_SIZES[set('textSize')]||TEXT_SIZES.default)[1]+'px';
  const f=(FONTS[set('font')]||FONTS.plex)[1];
  if(f){ root.style.setProperty('--display', f); root.style.setProperty('--body', f); } else { root.style.removeProperty('--display'); root.style.removeProperty('--body'); }
  root.classList.toggle('compact', set('density')==='compact');
  root.classList.toggle('motion-off', set('motion')==='reduced');
}
if(darkMQ.addEventListener) darkMQ.addEventListener('change', ()=>{ if(set('theme')==='system'){ applyAppearance(); if(!setEl.hidden) renderSettings(); } });

const setEl=document.getElementById('settings'), setBodyEl=document.getElementById('setBody'), setTabsEl=document.getElementById('setTabs');
const SET_TABS=[['look','Personalization'],['system','System'],['privacy','Privacy & security'],['saved','Saved prompts'],['prompts','Prompts'],['ops','Operations'],['bar','Quick access'],['keys','Keyboard']];
const PROMPT_GROUPS=[['every','Sent with every request',''], ['ops','Operations','Used by Merge, Reroot and Squash.'], ['tools',AI+'Tools','What Claude is asked when you use a '+AI+'tool.'], ['send','Include as','How a turn goes out when it’s included as a summary, an excerpt, or without its prompt or reply.'], ['naming',AI+'Naming','Used when Claude names branches, chats and projects (turn these on under System).']];
let setReturn=null;
const segs=(key, choices, label)=>`<div class="segs" role="group" aria-label="${esc(label)}">${choices.map(([v,l])=>`<button class="seg" data-set="${key}" data-val="${v}" aria-pressed="${String(set(key))===String(v)}">${esc(l)}</button>`).join('')}</div>`;
const setRow=(lab, sub, ctl)=>`<div class="setrow"><div class="lab">${lab}${sub?`<small>${sub}</small>`:''}</div>${ctl}</div>`;
function palCard(id){
  const m=palMode || shownMode(), t=paletteTokens(id, m), name=PALETTES[id]?PALETTES[id].name:themeFor(id).name;
  return `<button class="pal" data-set="palette" data-val="${id}" aria-pressed="${mget('palette', m)===id}"><div class="pv" style="background:${t.bg}"><i style="background:${t.side}"></i><div class="pm"><b style="background:${t.accent};width:55%"></b><b style="background:${t.line};width:85%"></b><b style="background:${t.line};width:70%"></b><b style="background:${t.surface};border:1px solid ${t.line};height:10px"></b></div></div><span>${esc(name||'Untitled')}${PALETTES[id]?'':' <em class="mine">yours</em>'}</span></button>`;
}
function swatch(key, label, val, auto){
  return `<div class="sw"><input type="color" data-tc="${key}" value="${val.toLowerCase()}" aria-label="${esc(label)}"><span class="swl">${esc(label)}${auto?'<em>auto</em>':''}</span><input class="hex" data-thex="${key}" value="${val}" maxlength="7" spellcheck="false" aria-label="${esc(label)} hex">${auto===false?`<button class="rmore" data-tauto="${key}" title="Work this color out from the others again">Auto</button>`:''}</div>`;
}
function contrastHTML(){
  const th=themeFor(editingTheme); if(!th) return '';
  const t=customTokens(th[editMode]);
  const checks=[['Text on cards',t.fg,t.surface,4.5],['Text on the background',t.fg,t.bg,4.5],['Secondary text',t.muted,t.surface,4.5],['Button text on the accent',t['on-accent'],t.accent,4.5],['Accent against cards',t.accent,t.surface,3]];
  return checks.map(([l,a,b,min])=>{ const r=contrast(a,b), ok=r>=min; return `<li class="${ok?'ok':'low'}"><span>${l}</span><b>${ok?'✓':'Low'} ${r.toFixed(1)}</b>${ok?'':`<small>aim for ${min}</small>`}</li>`; }).join('');
}
function themeEditorHTML(){
  const th=themeFor(editingTheme); if(!th) return '';
  const b=th[editMode], auto=autoColors(b);
  return `<section class="setsec themeed" data-ted>
    <div class="setrow"><input class="tname" data-tname value="${esc(th.name)}" aria-label="Theme name" maxlength="40">
      <div class="segs" role="group" aria-label="Version to edit">${['light','dark'].map(m=>`<button class="seg" data-tmode="${m}" aria-pressed="${editMode===m}">${m==='light'?'Light':'Dark'} version</button>`).join('')}</div></div>
    <p class="note">Every theme has a light and a dark version, used by the Mode setting above. The app behind this panel shows the ${editMode} version while you edit it.</p>
    <div class="swgrid">${THEME_CORE.map(([k,l])=>swatch(k,l,b[k])).join('')}</div>
    <details class="tmore" ${opts.open['theme-more']?'open':''} data-openkey="theme-more"><summary>More colors</summary><p class="note">Worked out from the colors above unless you change them.</p><div class="swgrid">${THEME_MORE.map(([k,l])=>swatch(k,l,b[k]||auto[k], b[k]?false:true)).join('')}</div></details>
    <div><h3 class="th3">Readability</h3><ul class="contrast" data-tcontrast>${contrastHTML()}</ul></div>
    <div class="tbar"><button class="btn primary" data-tdone>Done editing</button><button class="btn" data-tcopy>Copy theme code</button><button class="btn" data-tdup>Duplicate</button><button class="btn danger" data-tdel>Delete theme</button></div>
  </section>`;
}
