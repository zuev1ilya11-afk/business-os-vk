(()=>{
'use strict';
if(window.BOS_MASTER_DAY_PROGRESS_V129)return;
window.BOS_MASTER_DAY_PROGRESS_V129=true;

let queued=false,observer=null;
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const localIso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>localIso(new Date());
const dateOf=o=>String(o?.scheduled_date||'').slice(0,10);
const timeOf=o=>String(o?.scheduled_time||o?.time_slot||'').slice(0,5);
const completed=o=>String(o?.status||'')==='Выполнена'||String(o?.report_review_status||'')==='approved';
const active=o=>o&&!['Выполнена','Отменена'].includes(String(o.status||''));

function mine(){
  if(typeof ownOrders==='function')return (ownOrders()||[]).filter(Boolean);
  const all=(state?.orders||[]).filter(Boolean),u=state?.user||{};
  const ids=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(!ids.size)return String(u.role||'')==='master'?all:[];
  return all.filter(o=>[o.master_staff_id,o.master_id,o.master_vk_id,o.staff_id,o.vk_user_id].filter(Boolean).map(String).some(x=>ids.has(x)));
}
function metrics(orders=mine()){
  const d=today(),todayOrders=orders.filter(o=>dateOf(o)===d&&String(o?.status||'')!=='Отменена');
  const done=todayOrders.filter(completed).length;
  const remaining=todayOrders.filter(active).length;
  const upcoming=todayOrders.filter(active).map(o=>timeOf(o)).filter(Boolean).sort()[0]||'';
  const total=todayOrders.length;
  const pct=total?Math.min(100,Math.round(done/total*100)):0;
  return{total,done,remaining,upcoming,pct};
}
function render(){
  queued=false;
  const root=document.getElementById('content');
  if(!root||!masterMode()||String(state?.page||'')!=='home'){document.getElementById('masterDayProgressV129')?.remove();return}
  const m=metrics(),sig=JSON.stringify(m);
  let box=document.getElementById('masterDayProgressV129');
  if(box?.dataset.sig===sig)return;
  if(!box){
    box=document.createElement('section');box.id='masterDayProgressV129';box.className='masterV129';
    const daily=document.getElementById('masterDailyV127');
    const summary=document.getElementById('masterDaySummaryV128');
    if(summary)summary.insertAdjacentElement('beforebegin',box);else if(daily)daily.insertAdjacentElement('afterend',box);else root.prepend(box);
  }
  box.dataset.sig=sig;
  const next=m.upcoming?`Ближайшая в ${m.upcoming}`:(m.remaining?'Есть заявки без времени':'Активных заявок на сегодня нет');
  box.innerHTML=`<div class="masterV129Top"><div><small>ПЛАН ДНЯ</small><h3>${m.done} из ${m.total} выполнено</h3></div><strong>${m.pct}%</strong></div><div class="masterV129Bar" aria-label="Прогресс рабочего дня"><span style="width:${m.pct}%"></span></div><div class="masterV129Meta"><span>Осталось: <b>${m.remaining}</b></span><span>${next}</span></div>`;
}
function ensureObserver(){
  if(observer||!masterMode())return;
  const root=document.getElementById('content');if(!root)return;
  observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});
}
function schedule(){
  if(!masterMode())return;
  ensureObserver();if(queued)return;queued=true;requestAnimationFrame(render);
}
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);if(masterMode()){setTimeout(schedule,0);setTimeout(schedule,100)}return out};
setInterval(()=>{if(masterMode())schedule()},60000);
setTimeout(schedule,0);
window.BOS_MASTER_DAY_PROGRESS_V129_API={refresh:schedule,metrics};

const style=document.createElement('style');style.textContent=`
.masterV129{margin:0 0 16px;padding:13px 14px;border:1px solid rgba(96,165,250,.16);border-radius:16px;background:rgba(96,165,250,.035)}.masterV129Top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.masterV129Top small{display:block;color:var(--muted,#91a3b7);font-size:10px;font-weight:900;letter-spacing:.1em}.masterV129Top h3{margin:2px 0 0;font-size:16px}.masterV129Top strong{font-size:15px}.masterV129Bar{height:8px;margin-top:10px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.07)}.masterV129Bar span{display:block;height:100%;border-radius:inherit;background:currentColor;opacity:.7;transition:width .2s ease}.masterV129Meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;color:var(--muted,#91a3b7);font-size:11px}.masterV129Meta b{color:inherit}
@media(max-width:520px){.masterV129{padding:12px;margin-bottom:12px;border-radius:15px}.masterV129Meta{align-items:flex-start;flex-direction:column;gap:4px}}
`;document.head.appendChild(style);
})();