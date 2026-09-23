(()=>{
'use strict';
if(window.BOS_ORDER_LIFECYCLE_V106)return;window.BOS_ORDER_LIFECYCLE_V106=true;
const LIFECYCLE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-lifecycle-api';
const CLAIMS_GATEWAY='https://business-os-api-gateway.netlify.app/api/proxy/claims-api';
const CLAIMS_DIRECT='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api';
const nativeFetch=window.fetch.bind(window);
const handsOrder=o=>String(o?.external_source||'').toLowerCase()==='hands'||String(o?.external_id||'').startsWith('hands:');
const displayNo=o=>handsOrder(o)?String(o?.external_id||'').replace(/^hands:/,'').trim()||String(o?.id||''):String(o?.id||'');
window.BOS_ORDER_NO=displayNo;
const dispatcherMode=()=>String(state?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&isDispatcherPreview());

async function authHeaders(){const h=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};h['Content-Type']='application/json';return h}
async function lifecycle(action,payload={}){const r=await nativeFetch(LIFECYCLE,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,...payload})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка жизненного цикла заявки');return d}
async function claims(action,payload={}){let last;for(const url of [CLAIMS_GATEWAY,CLAIMS_DIRECT]){try{const r=await nativeFetch(url,{method:'POST',headers:await authHeaders(),body:JSON.stringify({action,...payload})}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok){const e=new Error(d.error||`HTTP ${r.status}`);e.status=r.status;throw e}return d}catch(e){last=e;if(url===CLAIMS_GATEWAY&&(e?.status===404||/failed to fetch|load failed|network|SERVICE_NOT_ALLOWED/i.test(String(e?.message||''))))continue;throw e}}throw last}

function parseBody(init){try{return typeof init?.body==='string'?JSON.parse(init.body):null}catch(_){return null}}
function syntheticError(error,status=409){return new Response(JSON.stringify({ok:false,error}),{status,headers:{'Content-Type':'application/json'}})}
window.fetch=async function(input,init){
  const url=typeof input==='string'?input:String(input?.url||''),body=parseBody(init);
  if(body?.action==='finalizeMasterReport'&&/\/report-api(?:$|\?)/.test(url))return nativeFetch(LIFECYCLE,{...init,headers:init?.headers||await authHeaders(),body:JSON.stringify({...body,action:'finalizeMasterReport'})});
  if(body?.action==='syncOrders'&&/\/hands-api(?:$|\?)/.test(url))return nativeFetch(LIFECYCLE,{...init,headers:init?.headers||await authHeaders(),body:JSON.stringify({...body,action:'syncHandsOrders'})});
  if((body?.action==='createOrder'||body?.action==='updateOrder')&&String(body?.status||'')==='Выполнена'){
    const cur=(state?.orders||[]).find(o=>String(o.id)===String(body.id));
    if(!cur||String(cur.status||'')!=='Выполнена')return syntheticError('Заявка становится выполненной только после приёма отчёта.');
  }
  return nativeFetch(input,init);
};

window.submitReportReview=async function(id,decision){
  if(state.busy)return;const msg=document.querySelector('#reviewMsg'),comment=document.querySelector('#reviewComment')?.value||'';
  if(decision==='rejected'&&!comment.trim()){if(msg)msg.textContent='Укажите причину отклонения.';return}
  state.busy=true;if(msg)msg.textContent=decision==='approved'?'Сохраняем отчёт в папку заявки на Google Диске…':'Сохраняем решение…';
  try{
    const role=(typeof isDispatcherPreview==='function'&&isDispatcherPreview())?'dispatcher':String(state.user?.role||'owner');
    const reviewerName=(role==='dispatcher'&&typeof dispatcherPreviewUser!=='undefined'&&dispatcherPreviewUser?.full_name)?dispatcherPreviewUser.full_name:(state.user?.full_name||'Сотрудник');
    const d=await lifecycle('reviewReport',{id,decision,comment,reviewer_role:role,reviewer_name:reviewerName});
    const i=state.orders.findIndex(x=>String(x.id)===String(id));if(i>=0)state.orders[i]={...state.orders[i],...d.order};
    closeModal();show('home');
  }catch(e){if(msg)msg.textContent=decision==='approved'?`Приём не выполнен: ${e.message}`:e.message}finally{state.busy=false}
};

window.openReopenClaimForm=function(orderId){
  const o=(state.orders||[]).find(x=>String(x.id)===String(orderId)||String(x.supabase_id||'')===String(orderId));if(!o)return;
  openModal(`<h2>Открыть рекламацию</h2><form id="claimForm" class="form"><textarea name="reason" placeholder="Причина рекламации" required></textarea><textarea name="required_work" placeholder="Что нужно исправить"></textarea><div class="two"><input type="date" name="scheduled_date"><input type="time" name="scheduled_time"></div><label><input id="claimPay" type="checkbox"> Оплатить повторный выезд</label><div id="claimPayBox" style="display:none"><input type="number" name="revisit_payment" min="0" step="0.01" placeholder="Сумма мастеру"><input name="payment_note" placeholder="Комментарий к оплате"></div><button class="primary wide" type="submit">Открыть рекламацию</button><p id="claimMsg" class="muted"></p></form>`);
  const pay=document.getElementById('claimPay'),box=document.getElementById('claimPayBox'),form=document.getElementById('claimForm');pay.onchange=()=>box.style.display=pay.checked?'block':'none';
  form.onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(form)),msg=document.getElementById('claimMsg');msg.textContent='Открываем рекламацию…';try{const d=await claims('reopenClaim',{id:o.id,reason:f.reason,required_work:f.required_work,scheduled_date:f.scheduled_date||null,scheduled_time:f.scheduled_time||null,pay_revisit:pay.checked,revisit_payment:Number(f.revisit_payment||0),payment_note:f.payment_note||''});state.claims=state.claims||[];if(d.claim)state.claims.unshift(d.claim);if(d.order){const i=state.orders.findIndex(x=>String(x.id)===String(o.id));if(i>=0)state.orders[i]={...state.orders[i],...d.order}}closeModal();show('home')}catch(err){msg.textContent=err.message}}
};

function completedHtml(){
  if(!dispatcherMode())return '';
  const done=(state.orders||[]).filter(o=>String(o.status)==='Выполнена').sort((a,b)=>String(b.completed_at||b.report_reviewed_at||b.updated_at||'').localeCompare(String(a.completed_at||a.report_reviewed_at||a.updated_at||'')));
  return `<section class="dashSection lifecycleDone"><div class="row"><div><div class="eyebrow">ВЫПОЛНЕННЫЕ</div><h2>Выполненные заявки</h2></div><span class="softChip">${done.length}</span></div>${done.length?done.slice(0,20).map(o=>`<section class="card lifecycleDoneCard" onclick="openOrder('${esc(o.id)}')"><div class="row"><div><b>№ ${esc(displayNo(o))}</b><div class="muted">${esc(o.work||'Заявка')}</div></div><span class="status success">Выполнена</span></div><p class="muted">${esc(o.client||'')} · ${esc(o.address||'')}</p><div class="lifecycleDoneActions"><button type="button" class="secondary" onclick="event.stopPropagation();openReopenClaimForm('${esc(o.id)}')">Открыть рекламацию</button></div></section>`).join(''):'<section class="card"><p class="muted">Выполненных заявок пока нет.</p></section>'}</section>`;
}
if(typeof pages!=='undefined'&&pages.home){const baseHome=pages.home;pages.home=function(){return baseHome.apply(this,arguments)+completedHtml()}}

function orderFromCard(card){const raw=card?.getAttribute('onclick')||'',m=raw.match(/openOrder\('([^']+)'\)/);return m?(state.orders||[]).find(o=>String(o.id)===String(m[1])):null}
function addClaimAction(card,o){if(!card||!o||String(o.status)!=='Выполнена'||card.querySelector('.lifecycleClaimAction'))return;let actions=card.querySelector('.dmCardActions');if(!actions){actions=document.createElement('div');actions.className='lifecycleCardActions';card.appendChild(actions)}const b=document.createElement('button');b.type='button';b.className='secondary lifecycleClaimAction';b.textContent='Открыть рекламацию';b.addEventListener('click',e=>{e.stopPropagation();openReopenClaimForm(String(o.id))});actions.appendChild(b)}
function recognizedReplace(text,id,no){if(!text||id===no)return text;const t=String(text);if(t.trim()===id)return t.replace(id,no);const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return t.replace(new RegExp(`(^|\\b)(Заявка\\s+|Заказ\\s+|#|№\\s*)?${escaped}(?=\\s*·|\\s*$)`),m=>m.replace(id,no))}
function patchNumbers(root=document){
  const hands=(state.orders||[]).filter(handsOrder);if(!hands.length)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes){let t=node.nodeValue||'',n=t;for(const o of hands)n=recognizedReplace(n,String(o.id),displayNo(o));if(n!==t)node.nodeValue=n}
}
function decorate(){
  document.querySelectorAll('.opsCompactOrder').forEach(card=>{const o=orderFromCard(card);if(o)addClaimAction(card,o)});
  document.querySelectorAll('#quickStatus,#orderForm select[name="status"]').forEach(sel=>{const opt=[...sel.options].find(x=>x.value==='Выполнена'||x.textContent==='Выполнена');if(opt&&sel.value!=='Выполнена'){opt.disabled=true;opt.title='Статус устанавливается после приёма отчёта'}});
  patchNumbers(document.getElementById('content')||document);patchNumbers(document.getElementById('modalRoot')||document);
}
const baseOpen=window.openOrder;if(typeof baseOpen==='function')window.openOrder=function(id){const out=baseOpen.apply(this,arguments);requestAnimationFrame(()=>{const o=(state.orders||[]).find(x=>String(x.id)===String(id)),modal=document.querySelector('.modal');if(!o||!modal)return;const h2=modal.querySelector('h2');if(h2&&handsOrder(o))h2.textContent=`№ ${displayNo(o)}`;if(String(o.status)==='Выполнена'&&!modal.querySelector('.lifecycleClaimModal')){const b=document.createElement('button');b.type='button';b.className='secondary wide lifecycleClaimModal';b.textContent='Открыть рекламацию';b.onclick=()=>openReopenClaimForm(String(o.id));modal.appendChild(b)}decorate()});return out};
let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate()})}new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});queueMicrotask(schedule);

const style=document.createElement('style');style.textContent=`.lifecycleDone{margin-top:16px}.lifecycleDoneCard{margin:8px 0}.lifecycleDoneActions{display:flex;justify-content:flex-end;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07)}.lifecycleDoneActions button,.lifecycleCardActions button{min-height:44px}.lifecycleCardActions{display:flex;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07)}.lifecycleCardActions .lifecycleClaimAction{width:100%}@media(max-width:760px){.dmCardActions .lifecycleClaimAction{grid-column:1/-1;min-height:44px}.lifecycleDoneActions button{width:100%;min-height:46px}}`;document.head.appendChild(style);
})();
