/* Chats: their order in the list, pinned, archived and hidden chats, titles and activity. */

/* one order everywhere: newest conversation first, so a new one appears at the top and stays there */
/* ---- Chat order, archive, unread ----
   The chat list sorts by last activity (as Claude does), date started, name, or your own order (drag a chat in the
   list). The page in Editor follows the same order, except that it keeps chats in the order they were started while
   sorting by activity, so it doesn't rearrange itself under you every time a reply comes in. Archived chats leave the
   list and the page; they're under Archived. */
const CONV_SORTS={updated:'Last activity', created:'Date started', name:'Name', custom:'Your order'};
const convSort = () => CONV_SORTS[opts.convSort] ? opts.convSort : 'updated';
const convGrouped = () => opts.convGroup!==false && (convSort()==='updated' || convSort()==='created');
const isArchived = r => !!convMeta(convKey(r)).archived;
const convUpdated = r => convMeta(convKey(r)).t || r.ts || 0;
const convStarted = r => r.ts || 0;
function sortRoots(list, how){
  const byKey=(a,b)=>convKey(b)-convKey(a);
  if(how==='name') return list.sort((a,b)=>convTitle(a).localeCompare(convTitle(b), undefined, {sensitivity:'base', numeric:true}) || byKey(a,b));
  if(how==='updated') return list.sort((a,b)=>convUpdated(b)-convUpdated(a) || byKey(a,b));
  if(how==='custom'){
    /* chats you haven't placed yet (new ones) come first, newest first */
    const idx=new Map((S.convOrder||[]).map((k,i)=>[k,i])), at=r=>idx.has(convKey(r)) ? idx.get(convKey(r)) : -1;
    return list.sort((a,b)=>(at(a)-at(b)) || byKey(a,b));
  }
  return list.sort(byKey);
}
const isPinned = r => !!convMeta(convKey(r)).pinned;
/* pinned chats first, keeping the order among each */
const pinnedFirst = list => [...list.filter(isPinned), ...list.filter(r=>!isPinned(r))];
/* the chats you work with, in page order (archived ones aside) */
function orderedRoots(){ return pinnedFirst(sortRoots(vRoots().filter(r=>!isArchived(r)), convSort()==='updated' ? 'created' : convSort())); }
const archivedRoots = () => sortRoots(vRoots().filter(isArchived), convSort());
const recentRoots = orderedRoots;
/* archived chats are off the page too, like hidden ones (Chat view can still open one) */
const isHidden = r => !!convMeta(convKey(r)).hidden || isArchived(r);
function dateGroup(t){
  if(!t) return 'Earlier';
  const now=new Date(), mid=new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), day=86400000;
  if(t>=mid) return 'Today';
  if(t>=mid-day) return 'Yesterday';
  if(t>=mid-7*day) return 'Previous 7 days';
  if(t>=mid-30*day) return 'Previous 30 days';
  return new Date(t).toLocaleDateString(undefined, now.getFullYear()===new Date(t).getFullYear() ? {month:'long'} : {month:'long', year:'numeric'});
}
const shownRoots = () => orderedRoots().filter(r=>!isHidden(r));
function convTip(r){
  const k=convKey(r), here=Object.keys(S.refs).filter(rid=>S.nodes[S.refs[rid].tip] && convKeyOf(S.refs[rid].tip)===k);
  const pickRef = here.find(rid=>rid===S.head) || here.find(rid=>refName(rid)==='main') || here[0];
  return pickRef ? S.refs[pickRef].tip : leafOf(r.id);
}
const firstRoot = defaultSel;
function touch(id){ const k=convKeyOf(id); if(k!=null) S.convs[k]=Object.assign(S.convs[k]||{}, {t:Date.now()}); }
const convTitle = r => convMeta(convKey(r)).title || ((r.kind==='summary' ? 'Rerooted: ' : '') + clip(plainText(r.text) || 'Untitled', 80));
