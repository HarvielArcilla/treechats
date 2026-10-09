/* Times: when a prompt was sent and a reply arrived, and how long it took. */

/* ---- Times ----
   As in Claude: a short time by each message (shown with its actions), the full date on hover, and how long a reply
   took. A reply being written counts up. */
const tsFull = t => new Date(t).toLocaleString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'});
function tsShort(t){
  const d=new Date(t), now=new Date(), day=86400000;
  const midnight=new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time=d.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
  if(t>=midnight) return time;
  if(t>=midnight-day) return 'Yesterday';
  if(t>=midnight-6*day) return d.toLocaleDateString(undefined, {weekday:'short'});
  return d.toLocaleDateString(undefined, d.getFullYear()===now.getFullYear() ? {month:'short', day:'numeric'} : {month:'short', day:'numeric', year:'numeric'});
}
function fmtElapsed(ms){
  const s=Math.max(0, Math.round(ms/1000));
  if(s<60) return s+'s';
  if(s<3600) return Math.floor(s/60)+'m '+(s%60)+'s';
  return Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m';
}
/* how long ago: "just now", "43 minutes ago", "3 hours ago", "2 days ago", then the date once it's over a week */
function tsAgo(t){
  const m=Math.floor((Date.now()-t)/60000);
  if(m<1) return 'just now';
  if(m<60) return m===1 ? '1 minute ago' : `${m} minutes ago`;
  const h=Math.floor(m/60); if(h<24) return h===1 ? '1 hour ago' : `${h} hours ago`;
  const d=Math.floor(h/24); if(d<7) return d===1 ? 'yesterday' : `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, new Date(t).getFullYear()===new Date().getFullYear() ? {month:'short', day:'numeric'} : {month:'short', day:'numeric', year:'numeric'});
}
const promptTime = n => n && n.ts ? `<span class="ts" data-ago="${n.ts}" title="Sent ${esc(tsFull(n.ts))}">${esc(tsAgo(n.ts))}</span>` : '';
/* a reply says when it came; how long it took is on hover */
function replyTime(n){
  if(!n || !n.rt || !n.reply) return '';
  const [a,b]=n.rt, secs=Math.round((b-a)/1000);
  return `<span class="ts" data-ago="${b}" title="Replied ${esc(tsFull(b))} · took ${secs<60?`${secs} second${secs===1?'':'s'}`:fmtElapsed(b-a)}">${esc(tsAgo(b))}</span>`;
}
/* the counter on a reply being written, every second; the "ago" labels, every half minute */
setInterval(()=>{ for(const el of document.querySelectorAll('[data-since]')) el.textContent=fmtElapsed(Date.now()-(+el.dataset.since)); }, 1000);
setInterval(()=>{ for(const el of document.querySelectorAll('[data-ago]')) el.textContent=tsAgo(+el.dataset.ago); }, 30000);
