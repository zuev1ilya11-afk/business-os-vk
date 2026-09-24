(()=>{
'use strict';
if(window.BOS_REPORT_REVIEW_QUEUE_V129)return;
window.BOS_REPORT_REVIEW_QUEUE_V129=true;

const canReview=()=>!(typeof isMasterPreview==='function'&&isMasterPreview())&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||['owner','manager','dispatcher'].includes(String(state?.user?.role||'')));
const pending=()=>((state?.orders||[]).filter(o=>o?.report_uploaded_at&&String(o?.report_review_status||'pending')==='pending')).sort((a,b)=>reportTs(a)-reportTs(b));
const reportTs=o=>{const n=new Date(String(o?.report_uploaded_at||o?.updated_at||o?.created_at||'')).getTime();return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER};
const nowTs=()=>{const fixed=window.__BOS_REPORT_QUEUE_NOW;if(fixed){const n=new Date(fixed).getTime();if(Number.isFinite(n))return n}return Date.now()};
const ageHours=o=>Math.max(0,Math.floor((nowTs()-reportTs(o))/3600000));
const waitLabel=o=>{const h=ageHours(o);if(h<1)return'меньше часа';if(h<24)return`${h} ч`;const d=Math.floor(h/24),rest=h%24;return rest?`${d} д ${rest} ч`:`${d} д`};
const filterOf=()=>String(window.__bosReportQueueFilter||'all');
const extra=o=>Number(o?.extra_work_amount||0)>0;
const overdue=o=>ageHours(o)>=24;
const match=(o,f=filterOf())=>f==='overdue'?overdue(o):f==='extra'?extra(o):true;
const moneyv=v=>typeof money==='function'?money(Number(v||0)):`${Number(v||0).toLocaleString('ru-RU')} ₽`;
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const orderNo=o=>{const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')};

function counts(list=pending()){return{all:list.length,overdue:list.filter(overdue).length,extra:list.filter(extra).length}}
function filterButtons(list){const c=counts(list),f=filterOf(),defs=[['all','Все',c.all],['overdue','Ждут >24 ч',c.overdue],['extra','С допработами',c.extra]];return `<div class="rrq129Filters" aria-label="Фильтр отчётов">${defs.map(([v,l,n])=>`<button type="button" class="${f===v?'primary':'secondary'}" onclick="setReportQueueFilterV129('${v}')">${escv(l)} <small>${n}</small></button>`).join('')}</div>`}
function card(o){const h=ageHours(o),attention=h>=24?' overdue':'';return `<button type="button" class="rrq129Card${attention}" data-report-order-id="${escv(o.id)}" onclick="openReportReview('${escv(o.id)}')"><div class="rrq129Top"><span><b>№ ${escv(orderNo(o))}</b><small>${escv(o?.master_name||'Мастер')}</small></span><strong>Ждёт ${escv(waitLabel(o))}</strong></div><div class="rrq129Address">${escv(o?.address||'Адрес не указан')}</div><div class="rrq129Meta"><span>Сумма: <b>${moneyv(o?.amount||0)}</b></span>${extra(o)?`<span class="rrq129Extra">Допработы: <b>+${moneyv(o.extra_work_amount)}</b></span>`:''}${Number(o?.uncompleted_work_amount||0)>0?`<span>Не выполнено: <b>−${moneyv(o.uncompleted_work_amount)}</b></span>`:''}</div></button>`}
function pageHtml(){const all=pending(),visible=all.filter(match);return `<div class="rrq129"><div class="rrq129Head"><div><div class="eyebrow">КОНТРОЛЬ ОТЧЁТОВ</div><h2>Очередь проверки</h2><p class="muted">Сначала показаны отчёты, которые ждут дольше всего.</p></div><button type="button" class="secondary" onclick="show('home')">Закрыть</button></div>${filterButtons(all)}<div class="rrq129Summary"><span>На проверке <b>${all.length}</b></span><span>Более 24 ч <b>${counts(all).overdue}</b></span><span>С допработами <b>${counts(all).extra}</b></span></div><section class="rrq129List">${visible.length?visible.map(card).join(''):'<div class="card rrq129Empty">По этому фильтру отчётов нет.</div>'}</section></div>`}
function renderPage(){if(!canReview())return false;const root=document.getElementById('content');if(!root)return false;state.page='reportQueueV129';root.innerHTML=pageHtml();document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));return true}
window.showReportQueueV129=function(){window.__bosReportQueueFilter='all';return renderPage()};
window.setReportQueueFilterV129=function(v){window.__bosReportQueueFilter=['all','overdue','extra'].includes(String(v))?String(v):'all';if(String(state?.page||'')==='reportQueueV129')return renderPage();return false};

function enhanceHome(){if(!canReview()||String(state?.page||'')!=='home')return;const queue=document.querySelector('#content .reportQueue');if(!queue||queue.querySelector('.rrq129Open'))return;const btn=document.createElement('button');btn.type='button';btn.className='secondary wide rrq129Open';btn.textContent='Все отчёты';btn.onclick=window.showReportQueueV129;queue.appendChild(btn)}
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(enhanceHome,0);setTimeout(enhanceHome,80);return out};
let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhanceHome()})}
const root=document.getElementById('content');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
setTimeout(enhanceHome,0);

const style=document.createElement('style');style.textContent=`
.rrq129{display:grid;gap:12px}.rrq129Head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.rrq129Head h2{margin:2px 0 4px}.rrq129Head p{margin:0}.rrq129Filters{display:flex;gap:7px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none}.rrq129Filters::-webkit-scrollbar{display:none}.rrq129Filters button{flex:0 0 auto;white-space:nowrap;min-height:40px}.rrq129Filters small{margin-left:4px;opacity:.75}.rrq129Summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.rrq129Summary span{padding:10px 11px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025);font-size:12px;color:var(--muted,#91a3b7)}.rrq129Summary b{display:block;margin-top:3px;color:var(--text,#eef4fb);font-size:18px}.rrq129List{display:grid;gap:8px}.rrq129Card{width:100%;display:grid;gap:8px;padding:13px;border:1px solid rgba(96,165,250,.18);border-radius:14px;background:var(--card,#111d2b);color:inherit;text-align:left;cursor:pointer}.rrq129Card.overdue{border-color:rgba(245,165,36,.42)}.rrq129Top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.rrq129Top>span{display:flex;flex-direction:column;gap:2px;min-width:0}.rrq129Top small{color:var(--muted,#91a3b7)}.rrq129Top strong{flex:0 0 auto;padding:4px 7px;border-radius:999px;background:rgba(96,165,250,.11);font-size:11px}.rrq129Card.overdue .rrq129Top strong{background:rgba(245,165,36,.13);color:#f5a524}.rrq129Address{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rrq129Meta{display:flex;flex-wrap:wrap;gap:6px 12px;color:var(--muted,#91a3b7);font-size:11px}.rrq129Meta b{color:var(--text,#eef4fb)}.rrq129Extra b{color:#74d99f}.rrq129Empty{padding:16px;text-align:center;color:var(--muted,#91a3b7)}
@media(max-width:520px){.rrq129Head{align-items:stretch;flex-direction:column}.rrq129Head>button{align-self:flex-start}.rrq129Summary{grid-template-columns:1fr}.rrq129Summary span{display:flex;align-items:center;justify-content:space-between}.rrq129Summary b{display:inline;margin:0}.rrq129Top{gap:8px}.rrq129Address{white-space:normal}.rrq129Meta{display:grid;gap:4px}}
`;document.head.appendChild(style);
})();
