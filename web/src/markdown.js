/* Showing replies: Markdown with tables, math and highlighted code (markdown.js does the work). */

/* Replies are rendered by markdown.js (Markdown with tables, math and highlighted code). It loads just after this
   script; anything drawn before then uses the tiny renderer below and is redrawn once it arrives. */
const mdCache=new Map(); let mdStandIn=false;
function md(src){
  const R=window.TreechatsMarkdown;
  if(!R){ mdStandIn=true; return mdRaw(src); }
  const hit=mdCache.get(src); if(hit!=null) return hit;
  const out=R.render(src); mdCache.set(src, out); if(mdCache.size>600) mdCache.delete(mdCache.keys().next().value);
  return out;
}
window.addEventListener('treechats-markdown', ()=>{ mdCache.clear(); if(mdStandIn){ mdStandIn=false; render(); if(cmpFor!=null) renderCompare(); } });
function mdRaw(src){
  const inline=t=>esc(t)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g,'$1<i>$2</i>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g,'$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  return src.split(/```[\w+-]*\n?/).map((seg,i)=>{
    if(i%2) return `<div class="codewrap"><div class="codehead"><span class="codelang">code</span><button class="codecopy" data-copycode type="button">Copy</button></div><pre><code>${esc(seg.replace(/\n$/,''))}</code></pre></div>`;
    return seg.trim().split(/\n{2,}/).filter(Boolean).map(block=>{
      const lines=block.split('\n');
      const h=lines[0].match(/^(#{1,4})\s+(.*)$/);
      if(h && lines.length===1) return `<p class="mdh mdh${h[1].length}">${inline(h[2])}</p>`;
      if(lines.every(l=>/^\s*[-*] /.test(l))) return '<ul>'+lines.map(l=>`<li>${inline(l.replace(/^\s*[-*] /,''))}</li>`).join('')+'</ul>';
      if(lines.every(l=>/^\s*\d+[.)] /.test(l))) return '<ol>'+lines.map(l=>`<li>${inline(l.replace(/^\s*\d+[.)] /,''))}</li>`).join('')+'</ol>';
      if(lines.every(l=>/^> ?/.test(l))) return `<blockquote>${lines.map(l=>inline(l.replace(/^> ?/,''))).join('<br>')}</blockquote>`;
      if(/^(-{3,}|\*{3,})$/.test(block.trim())) return '<hr>';
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}
/* Markdown read as one plain line, for titles and the short preview on each prompt */
const plainText = t => String(t||'').replace(/```[\s\S]*?(```|$)/g,' [code] ').replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm,' ').replace(/\s*\|\s*/g,' · ').replace(/^\s*#{1,6}\s+/gm,'').replace(/\*\*|__|`|\$\$?/g,'').replace(/(\s*·\s*)+/g,' · ').replace(/^[\s·]+|[\s·]+$/g,'').replace(/[ \t]+/g,' ').trim();
