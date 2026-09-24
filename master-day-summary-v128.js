(()=>{
'use strict';
if(window.BOS_MASTER_DAY_SUMMARY_V128)return;
window.BOS_MASTER_DAY_SUMMARY_V128=true;

let queued=false;
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const localIso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>localIso(new Date());
const orderNo=o=>{const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')};
const moneyv=v=>typeof money==='function'?money(v):`${Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`;

function mine(){
  if(typeof ownOrders==='function')return (ownOrders()||[]).filter(Boolean);
  const all=(state?.orders||[]).filter(Boolean),u=state?.user||{};
  const ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(!ids.size)return String(u.role||'')==='master'?all:[];
  return all.filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.staff_id,o.vk_user_id].filter(Boolean).map(String).some(x=>ids.has(x)));
}
function completedDay(o){
  if(o?.completed_at){const d=new Date(o.completed_at);if(!Number.isNaN(d.getTime()))return localIso(d)}
  return dateOf(o);
}
function completed(o){return String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved'}
function completedToday(orders=mine()){const d=today();return orders.filter(o=>completed(o)&&completedDay(o)===d)}
function payout(o){
  const raw=o?.amount;
  if(raw!==undefined&&raw!==null&&raw!==''){
    const amount=Number(raw);
    if(Number.isFinite(amount))return Math.round(amount*.85*.65*100)/100;
  }
  return num(o?.master_payout);
}
function extra(o){return num(o?.extra_work_amount)}
function orderTotal(o){return payout(o)+extra(o)}
function cardHtml(o){
  const client=String(o?.client||o?.client_name||'Клиент'),work=String(o?.work||o?.description||'Заявка');
  return `<button type="button" class="masterV128Done" data-order-id="${escv(o.id)}" onclick="openOrder('${escv(o.id)}')"><span><b>№ ${escv(orderNo(o))} · ${escv(client)}</b><small>${escv(work)}</small></span><strong>${escv(moneyv(orderTotal(o)))}</strong></button>`;
}
function removeLegacy(){document.querySelectorAll('#content .bosMasterTodayWorkflow').forEach(x=>x.remove())}
function render(){
  queued=false;
  removeLegacy();
  const root=document.getElementById('content');
  if(!root||!masterMode()||String(state?.page||'')!=='home'){document.getElementById('masterDaySummaryV128')?.remove();return}
  const done=completedToday(),base=done.reduce((a,o)=>a+payout(o),0),extras=done.reduce((a,o)=>a+extra(o),0),total=base+extras;
  const sig=JSON.stringify(done.map(o=>[o.id,o.status,o.completed_at,o.scheduled_date,o.amount,o.master_payout,o.extra_work_amount,o.client,o.work]));
  let box=document.getElementById('masterDaySummaryV128');
  if(box?.dataset.sig===sig)return;
  if(!box){box=document.createElement('section');box.id='masterDaySummaryV128';box.className='masterV128';const daily=document.getElementById('masterDailyV127');if(daily)daily.insertAdjacentElement('afterend',box);else root.prepend(box)}
  box.dataset.sig=sig;
  box.innerHTML=`<div class="masterV128Head"><div><small>ИТОГИ</small><h3>Сегодня</h3></div><span>${done.length} выполнено</span></div><div class="masterV128Metrics"><div><small>Выполнено</small><b>${done.length}</b></div><div><small>По заявкам</small><b>${escv(moneyv(base))}</b></div><div><small>Допработы</small><b>${escv(moneyv(extras))}</b></div><div class="total"><small>Итого</small><b>${escv(moneyv(total))}</b></div></div>${done.length?`<div class="masterV128List">${done.slice().sort((a,b)=>String(b.completed_at||b.scheduled_time||'').localeCompare(String(a.completed_at||a.scheduled_time||''))).slice(0,3).map(cardHtml).join('')}</div>`:'<p class="masterV128Empty">Сегодня завершённых заявок пока нет.</p>'}`;
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(render)}
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(schedule,0);setTimeout(schedule,100);return out};
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
setInterval(schedule,60000);
setTimeout(schedule,0);
window.BOS_MASTER_DAY_SUMMARY_V128_API={refresh:schedule,payout,completedToday};

const style=document.createElement('style');style.textContent=`
#content .bosMasterTodayWorkflow{display:none!important}.masterV128{margin:0 0 16px;padding:14px;border:1px solid rgba(34,197,94,.18);border-radius:18px;background:rgba(34,197,94,.045)}.masterV128Head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.masterV128Head small{display:block;color:var(--muted,#91a3b7);font-size:10px;font-weight:900;letter-spacing:.1em}.masterV128Head h3{margin:2px 0 0;font-size:18px}.masterV128Head>span{font-size:11px;color:var(--muted,#91a3b7)}.masterV128Metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.masterV128Metrics>div{min-width:0;padding:10px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.025)}.masterV128Metrics small,.masterV128Metrics b{display:block}.masterV128Metrics small{color:var(--muted,#91a3b7);font-size:10px;margin-bottom:4px}.masterV128Metrics b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV128Metrics .total{border-color:rgba(34,197,94,.28);background:rgba(34,197,94,.08)}.masterV128List{display:grid;gap:6px;margin-top:10px}.masterV128Done{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;padding:10px 11px;border:1px solid rgba(255,255,255,.07);border-radius:11px;background:rgba(255,255,255,.025);color:inherit}.masterV128Done>span{min-width:0;display:grid;gap:2px}.masterV128Done b,.masterV128Done small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.masterV128Done b{font-size:12px}.masterV128Done small{color:var(--muted,#91a3b7);font-size:10px}.masterV128Done strong{flex:0 0 auto;font-size:12px}.masterV128Empty{margin:10px 0 0;color:var(--muted,#91a3b7);font-size:12px}
@media(max-width:520px){.masterV128{padding:12px;margin-bottom:12px;border-radius:16px}.masterV128Metrics{grid-template-columns:1fr 1fr}.masterV128Metrics>div{padding:9px}.masterV128Done{align-items:flex-start;flex-direction:column;gap:5px}.masterV128Done strong{align-self:flex-start}}
`;document.head.appendChild(style);
})();