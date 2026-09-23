(()=>{
'use strict';
if(window.BOS_DISPATCHER_SMART_DISPATCH_V121)return;
window.BOS_DISPATCHER_SMART_DISPATCH_V121=true;

let queued=false;
const pad=n=>String(n).padStart(2,'0');
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());
const ordersPage=()=>String(state?.page||'')==='orders';
const active=o=>!!o&&!['Выполнена','Отменена'].includes(String(o?.status||''));
const unassigned=o=>active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim();
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10)||localToday();
const masterKey=m=>String(m?.vk_user_id||m?.external_id||m?.id||m?.staff_id||'');
const safe=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const orderIdFromCard=card=>String(card?.dataset?.orderId||'')||String(card?.getAttribute?.('onclick')||'').match(/openOrder\('([^']+)'\)/)?.[1]||'';
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const masterByKey=key=>(state?.masters||[]).find(m=>masterKey(m)===String(key))||null;
const slotFor=time=>{const h=Number(String(time||'').slice(0,2));return Number.isFinite(h)?`${pad(h)}:00–${pad(h+1)}:00`:''};

function recommendations(order){
  const rank=window.__dispatchSmartDraftCandidates;
  if(typeof rank!=='function'||!order)return [];
  const date=dateOf(order);
  try{return rank({...order,scheduled_date:date},date).slice(0,3)}catch(error){console.warn('Smart dispatch v121 ranking failed',error);return []}
}
function reasonText(candidate){
  const reasons=Array.isArray(candidate?.reasons)?candidate.reasons:[];
  const useful=reasons.filter(x=>!/ближайшее/i.test(String(x))).slice(0,2);
  return useful.join(' · ')||reasons.slice(0,2).join(' · ');
}
function candidateSignature(items,date){return `${date}|${items.map(x=>`${x.master_key}:${x.best_time}:${Math.round(Number(x.score)||0)}`).join('|')}`}
function candidateNode(candidate,index,order,date){
  const master=candidate.master||{};
  const name=master.full_name||master.name||'Мастер';
  const node=document.createElement('div');
  node.className=`dsd121Candidate${index===0?' best':''}`;
  node.dataset.master=String(candidate.master_key||'');
  node.dataset.time=String(candidate.best_time||'');
  node.innerHTML=`<div class="dsd121CandidateCopy"><div class="dsd121CandidateTitle"><b>${index===0?'Рекомендуем · ':''}${safe(name)}</b><span>${safe(candidate.best_time||'')}</span></div><small>${safe(reasonText(candidate))}</small></div>`;
  const button=document.createElement('button');
  button.type='button';
  button.className=index===0?'primary dsd121Assign':'secondary dsd121Assign';
  button.textContent='Назначить';
  button.setAttribute('aria-label',`Назначить ${name} на ${candidate.best_time||''}`);
  button.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    assign(order.id,candidate.master_key,candidate.best_time,date,button);
  });
  node.appendChild(button);
  return node;
}
function boxFor(card,orderId){
  const inside=card.querySelector?.(':scope > .dsd121');
  if(inside)return inside;
  const next=card.nextElementSibling;
  return next?.classList?.contains('dsd121')&&String(next.dataset.orderId||'')===String(orderId)?next:null;
}
function renderCard(card,order){
  let box=boxFor(card,order?.id);
  if(!unassigned(order)||order?.reschedule_requested){box?.remove();return}
  const date=dateOf(order),items=recommendations(order);
  if(!items.length){box?.remove();return}
  const signature=candidateSignature(items,date);
  if(box?.dataset.signature===signature)return;
  if(!box){
    box=document.createElement('section');
    box.className='dsd121';
    box.dataset.orderId=String(order.id);
    if(card.classList.contains('opsCompactOrder')){
      const actions=card.querySelector(':scope > .dmCardActions');
      card.insertBefore(box,actions||null);
    }else{
      box.classList.add('dsd121BoardList');
      card.insertAdjacentElement('afterend',box);
    }
  }
  box.dataset.signature=signature;
  box.replaceChildren();
  const head=document.createElement('div');head.className='dsd121Head';
  head.innerHTML=`<span>Умный подбор</span><small>${safe(date)} · лучшие свободные варианты</small>`;
  box.appendChild(head);
  const list=document.createElement('div');list.className='dsd121List';
  items.forEach((candidate,index)=>list.appendChild(candidateNode(candidate,index,order,date)));
  box.appendChild(list);
}

async function assign(orderId,masterValue,time,date,button){
  const order=orderById(orderId),master=masterByKey(masterValue);
  if(!order||!master||!unassigned(order)||state.busy)return false;
  const name=master.full_name||master.name||'мастера';
  if(!confirm(`Назначить ${name} на ${date} ${time}?`))return false;
  const box=button?.closest?.('.dsd121');
  const buttons=box?[...box.querySelectorAll('button')]:[];
  state.busy=true;buttons.forEach(x=>x.disabled=true);if(button)button.textContent='Назначаем…';
  try{
    const payload={id:order.id,master_vk_id:String(masterValue),scheduled_date:String(date),scheduled_time:String(time),time_slot:slotFor(time)};
    const result=await api('updateOrder',payload);
    if(!result?.ok)throw new Error(result?.error||'Не удалось назначить мастера');
    const index=(state.orders||[]).findIndex(o=>String(o?.id)===String(order.id));
    if(index>=0)state.orders[index]={...state.orders[index],...(result.order||{}),...payload,master_name:name};
    box?.remove();
    if(typeof show==='function')show('orders');else schedule();
    return true;
  }catch(error){
    if(button){button.textContent='Ошибка';button.title=error?.message||String(error)}
    setTimeout(()=>{if(button?.isConnected){button.textContent='Назначить';button.title=''}buttons.forEach(x=>x.disabled=false)},1400);
    return false;
  }finally{state.busy=false}
}
window.assignDispatcherRecommendation121=(orderId,masterValue,time,date)=>assign(orderId,masterValue,time,date||dateOf(orderById(orderId)),null);
window.__dispatcherSmartDispatch121=orderId=>{
  const order=orderById(orderId);if(!order)return [];
  return recommendations(order).map(c=>({master_key:c.master_key,master_name:c.master?.full_name||c.master?.name||'',best_time:c.best_time,score:c.score,reasons:[...(c.reasons||[])]}));
};

function cleanup(root){root?.querySelectorAll?.('.dsd121')?.forEach(node=>node.remove())}
function listTabActive(root){
  return [...root.querySelectorAll('.dbViewTabs button')].some(button=>button.classList.contains('primary')&&String(button.textContent||'').trim()==='Список');
}
function targetCards(root){
  const compact=[...root.querySelectorAll('#bosOrderList .opsCompactOrder')];
  if(compact.length)return compact;
  if(!listTabActive(root))return [];
  const seen=new Set();
  return [...root.querySelectorAll('.dbSchedule .dbOrderCard[data-order-id]')].filter(card=>{
    const id=orderIdFromCard(card);
    if(!id||seen.has(id))return false;
    seen.add(id);return true;
  });
}
function sync(){
  queued=false;
  const root=document.getElementById('content');if(!root)return;
  if(!dispatcherMode()||!ordersPage()){cleanup(root);return}
  if(typeof window.__dispatchSmartDraftCandidates!=='function'){setTimeout(schedule,60);return}
  const cards=targetCards(root);
  if(!cards.length){if(!listTabActive(root)&&!root.querySelector('#bosOrderList'))cleanup(root);return}
  cards.forEach(card=>{
    const id=orderIdFromCard(card),order=orderById(id);
    if(order)renderCard(card,order);else boxFor(card,id)?.remove();
  });
  root.querySelectorAll('.dsd121[data-order-id]').forEach(box=>{
    const id=String(box.dataset.orderId||'');
    if(!orderById(id)||!unassigned(orderById(id)))box.remove();
  });
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(sync)}
function start(){
  const root=document.getElementById('content');
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
  schedule();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);

const style=document.createElement('style');
style.textContent=`
#content .dsd121{margin:10px 0 2px;padding:10px;border:1px solid rgba(86,156,214,.24);border-radius:12px;background:rgba(63,126,181,.07)}
#content .dsd121.dsd121BoardList{margin:0 0 8px;width:100%;box-sizing:border-box}
#content .dsd121Head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}
#content .dsd121Head>span{font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--accent,#62a8ea)}
#content .dsd121Head>small{font-size:11px;color:var(--muted,#8e9baa);text-align:right}
#content .dsd121List{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
#content .dsd121Candidate{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.025)}
#content .dsd121Candidate.best{border-color:rgba(86,156,214,.42);background:rgba(63,126,181,.09)}
#content .dsd121CandidateCopy{min-width:0;flex:1}
#content .dsd121CandidateTitle{display:flex;align-items:center;justify-content:space-between;gap:7px;min-width:0}
#content .dsd121CandidateTitle b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
#content .dsd121CandidateTitle span{flex:0 0 auto;font-size:12px;font-weight:800}
#content .dsd121Candidate small{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted,#8e9baa);font-size:10px}
#content .dsd121Assign{min-height:36px;padding:7px 10px;font-size:11px;flex:0 0 auto}
@media(max-width:980px){#content .dsd121List{grid-template-columns:1fr}#content .dsd121Candidate small{white-space:normal}}
@media(max-width:520px){#content .dsd121{padding:9px;margin-top:8px}#content .dsd121Head{align-items:flex-start;flex-direction:column;gap:2px}#content .dsd121Head>small{text-align:left}#content .dsd121Candidate{padding:8px 7px}#content .dsd121Assign{min-height:42px;padding:8px 11px}}
`;
document.head.appendChild(style);
})();
