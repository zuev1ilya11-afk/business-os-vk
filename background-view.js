// Reconcile renderer-owned nodes; retain decorations installed by other UI layers.
(()=>{
 'use strict';
 const snapshots=new WeakMap();
 const keys=['id','data-fin-key','data-fin-kpi','data-fin-detail-kpi','data-owner-kpi','data-owner-order','data-owner-master','data-oc-order','data-order-id','data-date'];
 const markup=node=>node.nodeType===1?node.outerHTML:node.nodeType===11?node.innerHTML:node.nodeValue;
 function key(node){
  if(node.nodeType!==1)return '';
  for(const name of keys)if(node.hasAttribute(name))return node.tagName+':'+name+':'+node.getAttribute(name);
  if(node.hasAttribute('data-master'))return node.tagName+':slot:'+node.getAttribute('data-master')+':'+(node.getAttribute('data-time')||'');
  return '';
 }
 function source(node){return snapshots.get(node)?.source||node}
 function compatible(a,b){const before=source(a);return a.nodeType===b.nodeType&&(a.nodeType!==1||(a.tagName===b.tagName&&key(before)===key(b)&&(!/^(DIV|SECTION|ASIDE|MAIN|HEADER|ARTICLE)$/.test(a.tagName)||before.classList[0]===b.classList[0])))}
 function remember(node,template=node){
  snapshots.set(node,{source:template.cloneNode(false),html:markup(template),children:[...node.childNodes]});
  [...node.childNodes].forEach((child,i)=>remember(child,template.childNodes[i]));
 }
 function update(node,next){
  const previous=snapshots.get(node);
  if(previous&&previous.html===markup(next))return;
  if(node.nodeType!==1){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;remember(node,next);return}
  const before=previous?.source||node,open=node.tagName==='DETAILS'?node.open:null;
  for(const attr of [...before.attributes])if(!next.hasAttribute(attr.name))node.removeAttribute(attr.name);
  for(const attr of next.attributes)if(before.getAttribute(attr.name)!==attr.value)node.setAttribute(attr.name,attr.value);
  reconcile(node,next);
  if(open!==null)node.open=open;
 }
 function reconcile(parent,next){
  // Some legacy controls replace all children directly. Adopt that current tree
  // before reconciling; otherwise its replacement would look like a decoration.
  const saved=snapshots.get(parent);
  if(saved?.children.length&&parent.childNodes.length&&!saved.children.some(n=>n.parentNode===parent||n.isConnected))remember(parent);
  const previous=snapshots.get(parent),old=(previous?.children||[...parent.childNodes]).filter(n=>n.parentNode===parent||n.isConnected),owned=new Set(old),used=new Set();
  const keyed=new Map(old.map(n=>[key(source(n)),n]).filter(([k])=>k));
  const children=[];
  let cursor=parent.firstChild;
  const nextOwned=()=>{while(cursor&&!owned.has(cursor))cursor=cursor.nextSibling};nextOwned();
  for(const desired of [...next.childNodes]){
   const k=key(desired);let node=k?keyed.get(k):old.find(n=>!used.has(n)&&!key(source(n))&&compatible(n,desired));
   if(!node||!compatible(node,desired)){node=desired.cloneNode(true);remember(node,desired);parent.insertBefore(node,cursor)}
   else{used.add(node);if(node.parentNode===parent&&node!==cursor)parent.insertBefore(node,cursor);update(node,desired)}
   children.push(node);if(node.parentNode===parent){cursor=node.nextSibling;nextOwned()}
  }
  for(const node of old)if(!used.has(node))node.remove();
  const shell=next.nodeType===11?(previous?.source||parent.cloneNode(false)):next.cloneNode(false);
  const desired=shell.cloneNode(false);desired.append(...[...next.childNodes].map(n=>n.cloneNode(true)));
  snapshots.set(parent,{source:shell,html:markup(desired),children});
 }
 window.BOS_RENDER_CONTENT=function(parent,html){parent.innerHTML=html;remember(parent)};
 window.BOS_PATCH_CONTENT=function(parent,html){
  const template=document.createElement('template');template.innerHTML=html;
  const focused=document.activeElement;
  const scroll=[parent,...parent.querySelectorAll('*')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>[n,n.scrollTop,n.scrollLeft]);
  reconcile(parent,template.content);
  if(focused!==document.activeElement&&focused?.isConnected)focused.focus({preventScroll:true});
  for(const [node,top,left] of scroll)if(node.isConnected){node.scrollTop=top;node.scrollLeft=left}
 };
})();
