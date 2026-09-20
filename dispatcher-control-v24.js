(()=>{
'use strict';
const MIN_DESKTOP=1050;
let controlMode=sessionStorage.getItem('bosDispatchV24Control')==='1';
let filter='all';
let rendering=false;
let lastSignature='';

function dispatcherDesktop(){return window.innerWidth>=MIN_DESKTOP&&((typeof isDispatcherPreview==='function'&&isDispatcherPreview())||String(state?.user?.role||'')==='dispatcher')}
function active(o){return !['Выполнена','Отменена'].includes(String(o?.status||''))}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function timeOf(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function minutes(t){const [h,m]=String(t||'00:00').split(':').map(Number);return h*60+m}
function halfHour(t){if(!/^\d{2}:\d{2}$/.test(String(t||'')))return '';const [h,m]=String(t).split(':').map(Number);return `${String(h).padStart(2,'0')}:${m<30?'00':'30'}`}
function escv(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function masterIds(o){return [o?.master_staff_id,o?.master_id,o?.master_vk_id,o?.master_name].filter(Boolean).map(String)}
function masterKey(o){return masterIds(o)[0]||''}
function unassigned(o){return active(o)&&!o?.master_staff_id&&!o?.master_id&&!o?.master_vk_id&&!String(o?.master_name||'').trim()}
function overdue(o){return active(o)&&!!dateOf(o)&&dateOf(o)<localToday()}
function unscheduled(o){return active(o)&&(!dateOf(o)||!timeOf(o))}
function pastTime(o){if(!active(o)||dateOf(o)!==localToday()||!/^\d{2}:\d{2}$/.test(timeOf(o)))return false;const d=new Date();return minutes(timeOf(o))+30<d.getHours()*60+d.getMinutes()}
function conflictsMap(){const map=new Map();for(const o of (state.orders||[]).filter(active)){const d=dateOf(o),t=halfHour(timeOf(o)),m=masterKey(o);if(!d||!t||!m)continue;const k=`${m}|${d}|${t}`;const list=map.get(k)||[];list.push(o);map.set(k,list)}const ids=new Set();for(const list of map.values())if(list.length>1)for(const o of list)ids.add(String(o.id));return ids}
function issueTypes(o,conflicts){const x=[];if(o.reschedule_requested)x.push('reschedule');if(unassigned(o))x.push('unassigned');if(overdue(o))x.push('overdue');if(conflicts.has(String(o.id)))x.push('conflict');if(pastTime(o))x.push('past');if(unscheduled(o))x.push('unscheduled');return x}
function issues(){const conflicts=conflictsMap();return (state.orders||[]).filter(active).map(o=>({o,types:issueTypes(o,conflicts)})).filter(x=>x.types.length)}
function count(type,list){return type==='all'?list.length:list.filter(x=>x.types.includes(type)).length}
function severity(types){for(const x of ['reschedule','conflict','overdue','unassigned','past','unscheduled']){const i=types.indexOf(x);if(i>=0)return ['reschedule','conflict','overdue','unassigned','past','unscheduled'].indexOf(x)}return 99}
function label(type){return ({reschedule:'Нужно перенести',unassigned:'Без мастера',overdue:'Просрочено',conflict:'Конфликт времени',past:'Время прошло',unscheduled:'Без даты/времени'})[type]||type}
function badge(type){const cls=['reschedule','conflict','overdue'].includes(type)?' danger':type==='unassigned'?' warn':'';return `<span class="dbV24Badge${cls}">${label(type)}</span>`}
function noOf(o){const x=String(o?.external_id||'');return x.startsWith('hands:')?x.slice(6):String(o?.id||'')}
function phoneHref(v){let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p}
function card(x){const o=x.o,href=phoneHref(o.phone);return `<article class="dbV24Card" data-order-id="${escv(o.id)}"><div class="dbV24CardTop"><div><b>№ ${escv(noOf(o))} · ${escv(o.client||'Клиент')}</b><span>${escv(o.work||'Заявка')}</span></div><strong>${escv(o.master_name||'Без мастера')}</strong></div><div class="dbV24Badges">${x.types.map(badge).join('')}</div><div class="dbV24Meta"><span>${escv(dateOf(o)||'Без даты')} ${escv(timeOf(o)||'')}</span><span>${escv(o.address||'Адрес не указан')}</span>${o.reschedule_reason?`<span>Причина: ${escv(o.reschedule_reason)}</span>`:''}</div><div class="dbV24Actions"><button class="secondary" onclick="dispatchControlV24Select('${escv(o.id)}')">Открыть</button><button class="secondary" onclick="dispatchControlV24Plan('${escv(o.id)}')">План дня</button>${o.reschedule_requested&&typeof window.openDispatcherReschedule==='function'?`<button class="secondary" onclick="openDispatcherReschedule('${escv(o.id)}')">Перенести</button>`:''}${href?`<a class="secondary dbV24Link" href="tel:${escv(href)}">Позвонить</a>`:''}</div></article>`}
function signature(){return JSON.stringify((state.orders||[]).filter(active).map(o=>[o.id,dateOf(o),timeOf(o),o.master_staff_id,o.master_vk_id,o.master_name,o.status,o.reschedule_requested,o.reschedule_reason]))}
function renderHtml(){const all=issues().sort((a,b)=>severity(a.types)-severity(b.types)||String(dateOf(a.o)).localeCompare(String(dateOf(b.o)))||String(timeOf(a.o)).localeCompare(String(timeOf(b.o))));const visible=filter==='all'?all:all.filter(x=>x.types.includes(filter));const types=['all','reschedule','unassigned','overdue','conflict','past','unscheduled'];return `<div class="dbV24Control"><div class="dbV24Head"><div><span>ДИСПЕТЧЕРСКАЯ · КОНТРОЛЬ</span><h3>Требует внимания</h3><p>Показываются только активные заявки с проблемами.</p></div><div class="dbV24Total"><strong>${all.length}</strong><span>заявок</span></div></div><div class="dbV24Filters">${types.map(t=>`<button class="${filter===t?'primary':'secondary'}" onclick="dispatchControlV24Filter('${t}')">${t==='all'?'Все':label(t)} · ${count(t,all)}</button>`).join('')}</div><div class="dbV24List">${visible.map(card).join('')||'<div class="dbV24Empty"><b>Нет заявок в этой категории</b><span>Все проблемы по выбранному фильтру разобраны.</span></div>'}</div></div>`}
function injectTab(){const tabs=document.querySelector('.dbViewTabs');if(!tabs||tabs.querySelector('.dbV24Tab'))return;const b=document.createElement('button');b.type='button';b.className='secondary dbV24Tab';b.onclick=()=>setControl(true);tabs.appendChild(b)}
function syncTab(){const b=document.querySelector('.dbV24Tab');if(!b)return;const n=issues().length;b.className=`dbV24Tab ${controlMode?'primary':'secondary'}`;b.textContent=`Контроль${n?` · ${n}`:''}`}
function setControl(on){controlMode=!!on;sessionStorage.setItem('bosDispatchV24Control',controlMode?'1':'0');lastSignature='';if(controlMode){sessionStorage.setItem('bosDispatchV23Plan','0');render(true)}else if(typeof show==='function')show('orders')}
function render(force=false){if(rendering||!controlMode||!dispatcherDesktop())return;const schedule=document.querySelector('.dbSchedule');if(!schedule)return;const sig=signature()+`|${filter}`;if(!force&&sig===lastSignature&&schedule.querySelector('.dbV24Control')){syncTab();return}rendering=true;try{schedule.innerHTML=renderHtml();lastSignature=sig;syncTab()}finally{rendering=false}}
function enhance(){if(!dispatcherDesktop()||!document.querySelector('.dbBoard'))return;injectTab();syncTab();if(controlMode)render()}

window.dispatchControlV24Filter=function(v){filter=String(v||'all');lastSignature='';render(true)};
window.dispatchControlV24Select=function(id){if(typeof selectDispatchBoardOrder==='function')selectDispatchBoardOrder(String(id));setTimeout(()=>{if(controlMode)render(true);document.getElementById('dispatchBoardDetail')?.scrollIntoView({block:'nearest'})},0)};
window.dispatchControlV24Plan=function(id){const o=(state.orders||[]).find(x=>String(x.id)===String(id));controlMode=false;sessionStorage.setItem('bosDispatchV24Control','0');const d=dateOf(o)||localToday();if(typeof setDispatchBoardDate==='function')setDispatchBoardDate(d);setTimeout(()=>window.dispatchBoardV23Plan?.(true),0)};
window.dispatchControlV24=function(on=true){setControl(on)};
document.addEventListener('click',e=>{const b=e.target.closest?.('.dbViewTabs button');if(!b||b.classList.contains('dbV24Tab'))return;if(controlMode){controlMode=false;sessionStorage.setItem('bosDispatchV24Control','0');lastSignature=''}},true);
const observer=new MutationObserver(()=>requestAnimationFrame(enhance));observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('resize',()=>requestAnimationFrame(enhance));
setInterval(()=>{if(controlMode)render()},60000);
setTimeout(enhance,0);

const style=document.createElement('style');style.textContent=`
@media(min-width:${MIN_DESKTOP}px){.dbV24Control{display:grid;gap:12px}.dbV24Head{display:flex;justify-content:space-between;gap:16px;align-items:center;background:var(--card,#fff);border:1px solid rgba(127,127,127,.18);border-radius:14px;padding:14px}.dbV24Head span,.dbV24Head p{font-size:12px;color:var(--muted,#6b7280);margin:0}.dbV24Head h3{margin:3px 0}.dbV24Total{display:grid;text-align:center;min-width:90px}.dbV24Total strong{font-size:28px}.dbV24Total span{font-size:11px;color:var(--muted,#6b7280)}.dbV24Filters{display:flex;gap:7px;flex-wrap:wrap}.dbV24Filters button{font-size:12px}.dbV24List{display:grid;gap:8px;max-height:calc(100vh - 330px);overflow:auto;padding-right:2px}.dbV24Card{background:var(--card,#fff);border:1px solid rgba(127,127,127,.18);border-radius:13px;padding:11px;display:grid;gap:8px}.dbV24CardTop{display:flex;justify-content:space-between;gap:12px}.dbV24CardTop>div{display:grid;gap:2px;min-width:0}.dbV24CardTop span,.dbV24CardTop strong{font-size:12px}.dbV24Badges,.dbV24Actions,.dbV24Meta{display:flex;gap:6px;flex-wrap:wrap}.dbV24Badge{border-radius:999px;padding:4px 7px;font-size:10px;font-weight:700;background:rgba(37,99,235,.08);color:#2563eb}.dbV24Badge.warn{background:rgba(217,119,6,.10);color:#b45309}.dbV24Badge.danger{background:rgba(220,38,38,.09);color:#b91c1c}.dbV24Meta span{font-size:11px;color:var(--muted,#6b7280)}.dbV24Actions button,.dbV24Actions a{font-size:11px;padding:6px 9px}.dbV24Link{text-decoration:none;display:inline-flex;align-items:center}.dbV24Empty{padding:28px;text-align:center;border:1px dashed rgba(127,127,127,.25);border-radius:14px;display:grid;gap:4px}.dbV24Empty span{font-size:12px;color:var(--muted,#6b7280)}}
@media(max-width:${MIN_DESKTOP-1}px){.dbV24Tab{display:none!important}}
`;document.head.appendChild(style);
})();
