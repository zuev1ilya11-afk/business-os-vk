(()=>{
'use strict';
if(window.BOS_DISPATCHER_UI_REDESIGN_V183)return;
const MIN_DESKTOP=1050;
let queued=false;
let selectedId='';

function appState(){try{return typeof state!=='undefined'&&state?state:null}catch(_){return null}}
function dispatcherMode(){const s=appState();return String(s?.user?.role||'')==='dispatcher'||(typeof isDispatcherPreview==='function'&&!!isDispatcherPreview())}
function active(o){return !!o&&!['Выполнена','Отменена'].includes(String(o?.status||''))}
function dateOf(o){return String(o?.scheduled_date||'').slice(0,10)}
function timeOf(o){return String(o?.scheduled_time||o?.time_slot||'').slice(0,5)}
function orderNo(o){const ext=String(o?.external_id||'');return ext.startsWith('hands:')?ext.slice(6):String(o?.id||'')}
function moneyOf(v){try{if(typeof money==='function')return money(v)}catch(_){}return `${Number(v||0).toLocaleString('ru-RU')} ₽`}
function masterKey(o){return String(o?.master_staff_id||o?.master_vk_id||o?.master_id||o?.master_name||'').trim()}
function unassigned(o){return active(o)&&!masterKey(o)}
function safe(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function selectedDate(){return String(document.getElementById('dispatchBoardDate')?.value||'').slice(0,10)||today()}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function orderById(id){return (appState()?.orders||[]).find(o=>String(o?.id)===String(id))||null}
function masterIds(m){return [m?.id,m?.staff_id,m?.master_staff_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String)}
function orderMasterIds(o){return [o?.master_staff_id,o?.master_id,o?.master_vk_id].filter(Boolean).map(String)}
function sameMaster(m,o){const ids=masterIds(m),oid=orderMasterIds(o);return ids.some(x=>oid.includes(x))||String(m?.full_name||'')===String(o?.master_name||'')}
function monthShort(date){if(!date)return'';const m=Number(String(date).slice(5,7));return ['','янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][m]||''}
function dayShort(date){return date?String(date).slice(8,10).replace(/^0/,''):''}
function stageLabel(o){
  if(o?.reschedule_requested)return ['warn','Перенос'];
  if(unassigned(o))return ['danger','Нет мастера'];
  const stage=String(o?.master_workflow_stage||'');
  if(stage==='started')return ['work','В работе'];
  if(stage==='departed')return ['away','На выезде'];
  if(String(o?.status||'')==='Выполнена')return ['done','Завершено'];
  return ['ok',String(o?.status||'В работе')];
}
function conflictGroups(date){
  const groups=new Map();
  (appState()?.orders||[]).filter(active).filter(o=>dateOf(o)===date&&masterKey(o)&&timeOf(o)).forEach(o=>{
    const key=`${masterKey(o)}|${timeOf(o).slice(0,2)}`;
    groups.set(key,(groups.get(key)||0)+1);
  });
  return [...groups.values()].filter(n=>n>1).length;
}
function stats(){
  const s=appState(),date=selectedDate();
  const dayOrders=(s?.orders||[]).filter(active).filter(o=>dateOf(o)===date);
  const free=(s?.masters||[]).filter(m=>!dayOrders.some(o=>sameMaster(m,o))).length;
  const noMaster=dayOrders.filter(unassigned).length;
  const transfers=(s?.orders||[]).filter(o=>active(o)&&o?.reschedule_requested).length;
  return {date,free,conflicts:conflictGroups(date),noMaster,transfers};
}
function kpisHtml(x){return `<section class="du183Kpis" aria-label="Сводка диспетчерской"><article class="du183Kpi free"><span class="du183KpiIcon">✓</span><div><strong>${x.free}</strong><span>Свободных мастеров</span></div></article><article class="du183Kpi conflict"><span class="du183KpiIcon">!</span><div><strong>${x.conflicts}</strong><span>Конфликтов в расписании</span></div></article><article class="du183Kpi unassigned"><span class="du183KpiIcon">●</span><div><strong>${x.noMaster}</strong><span>Заявок без мастера</span></div></article><article class="du183Kpi transfer"><span class="du183KpiIcon">◷</span><div><strong>${x.transfers}</strong><span>Переносов</span></div></article></section>`}
function ensureKpis(board){
  const tools=board.querySelector('.dbV21Tools');
  if(!tools)return;
  const x=stats(),sig=`${x.date}|${x.free}|${x.conflicts}|${x.noMaster}|${x.transfers}`;
  let box=tools.querySelector(':scope>.du183Kpis');
  if(!box){box=document.createElement('div');box.innerHTML=kpisHtml(x);box=box.firstElementChild;tools.appendChild(box)}
  if(box.dataset.signature!==sig){box.dataset.signature=sig;box.innerHTML=kpisHtml(x).replace(/^<section[^>]*>|<\/section>$/g,'')}
}
function relocateTopControls(board){
  const toolbar=board.querySelector('.dbToolbar'),quick=board.querySelector('.dbV21QuickDates');
  if(toolbar&&quick&&quick.parentElement!==toolbar){
    const add=[...toolbar.children].find(x=>x.matches?.('button')&&String(x.textContent||'').includes('Новая'));
    toolbar.insertBefore(quick,add||null);
  }
}
function markStatusRows(board){
  const layout=board.querySelector('.dbLayout');if(!layout)return;
  [...board.children].forEach(node=>{
    if(node===layout||node.classList?.contains('du183Kpis'))return;
    const text=String(node.textContent||'').replace(/\s+/g,' ').trim();
    if(text.startsWith('Этапы мастеров')||text.startsWith('Работа мастеров'))node.classList.add('du183StatusStrip');
  });
}
function enhanceAttention(board){
  board.querySelectorAll('.dbTray .dbOrderCard[data-order-id]').forEach(card=>{
    const o=orderById(card.dataset.orderId);if(!o)return;
    let amount=card.querySelector(':scope>.du183AttentionAmount');
    if(!amount){amount=document.createElement('strong');amount.className='du183AttentionAmount';card.appendChild(amount)}
    amount.textContent=moneyOf(o.amount||0);
  });
}
function listCardSignature(o){return [o?.id,o?.client,o?.work,o?.address,o?.master_name,o?.amount,o?.status,o?.scheduled_date,o?.scheduled_time,o?.time_slot,o?.reschedule_requested,o?.master_workflow_stage].join('|')}
function enhanceListCards(board){
  board.querySelectorAll('.dbV94ListCard[data-order-id]').forEach(card=>{
    const o=orderById(card.dataset.orderId);if(!o)return;
    const sig=listCardSignature(o);if(card.dataset.du183Signature===sig)return;
    card.dataset.du183Signature=sig;
    const [statusCls,status]=stageLabel(o),date=dateOf(o),time=timeOf(o);
    card.innerHTML=`<div class="du183Date"><b>${safe(dayShort(date)||'—')}</b><span>${safe(monthShort(date)||'без даты')}</span><small>${safe(time||'')}</small></div><div class="dbV94ListTop"><b>№ ${safe(orderNo(o))} · ${safe(o.client||'Клиент')}</b><span class="dbV94Status du183Status ${statusCls}">${safe(status)}</span></div><div class="dbV94ListWork">${safe(o.work||'Работа не указана')}</div><div class="dbV94ListMeta"><span class="du183Address">⌖ ${safe(o.address||'Адрес не указан')}</span></div><div class="du183CardSide"><span class="du183Master">${safe(o.master_name||'Мастер не назначен')}</span><strong class="du183Amount">${safe(moneyOf(o.amount||0))}</strong><span class="du183Chevron">›</span></div>`;
    card.classList.toggle('du183Unassigned',unassigned(o));
    card.classList.toggle('du183Transfer',!!o.reschedule_requested);
  });
  const chosen=selectedId||board.querySelector('.dbOrderCard.selected[data-order-id]')?.dataset?.orderId||'';
  board.querySelectorAll('.dbV94ListCard[data-order-id]').forEach(card=>card.classList.toggle('du183Selected',!!chosen&&String(card.dataset.orderId)===String(chosen)));
}
function currentSelectedOrder(board){
  const id=selectedId||board.querySelector('.dbOrderCard.selected[data-order-id]')?.dataset?.orderId||board.querySelector('.dbV94ListCard.du183Selected[data-order-id]')?.dataset?.orderId||'';
  return orderById(id);
}
function enhanceDetail(board){
  const detail=board.querySelector('#dispatchBoardDetail .dbDetail');if(!detail)return;
  const o=currentSelectedOrder(board);if(!o)return;
  let alert=detail.querySelector(':scope>.du183PriorityAlert');
  let kind='',title='',text='';
  if(unassigned(o)){kind='danger';title='Нет мастера';text='Требуется назначить мастера на заявку'}
  else if(o.reschedule_requested){kind='warn';title='Нужно перенести';text=String(o.reschedule_reason||'Требуется согласовать новую дату и время')}
  else if(dateOf(o)&&dateOf(o)<today()){kind='warn';title='Просрочена';text='Проверьте дату и дальнейшее действие по заявке'}
  if(!kind){alert?.remove();return}
  if(!alert){alert=document.createElement('div');alert.className='du183PriorityAlert';const head=detail.querySelector(':scope>.dbPanelHead');head?.insertAdjacentElement('afterend',alert)}
  alert.className=`du183PriorityAlert ${kind}`;alert.innerHTML=`<b>${safe(title)}</b><span>${safe(text)}</span>`;
}
function decorate(){
  queued=false;
  const board=document.querySelector('#content .dbBoard');
  if(!board||!dispatcherMode()||window.innerWidth<MIN_DESKTOP||String(appState()?.page||'')!=='orders')return;
  board.classList.add('du183Board');
  relocateTopControls(board);
  ensureKpis(board);
  markStatusRows(board);
  enhanceAttention(board);
  enhanceListCards(board);
  enhanceDetail(board);
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}

document.addEventListener('click',event=>{
  const card=event.target.closest?.('.dbV94ListCard[data-order-id],.dbOrderCard[data-order-id]');
  if(card&&document.querySelector('#content .dbBoard')?.contains(card)){selectedId=String(card.dataset.orderId||'');setTimeout(schedule,0)}
},true);

const start=()=>{const content=document.getElementById('content');if(content)new MutationObserver(schedule).observe(content,{childList:true,subtree:true});schedule()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.addEventListener('resize',schedule);
window.BOS_DISPATCHER_UI_REDESIGN_V183={refresh:schedule};

const style=document.createElement('style');style.textContent=`
@media(min-width:${MIN_DESKTOP}px){
#content .du183Board{--du-bg:#08131f;--du-panel:#0d1d2c;--du-card:#10263a;--du-border:rgba(126,166,204,.18);--du-muted:#8fa8bf;display:block;max-width:none}
#content .du183Board .dbTop{align-items:center;padding-bottom:15px;margin-bottom:12px;border-bottom:1px solid rgba(142,177,211,.13)}
#content .du183Board .dbTop>div:first-child>span{font-size:11px;letter-spacing:.14em;color:#7fa8d4;font-weight:800}
#content .du183Board .dbTop h2{font-size:27px;line-height:1.1;margin:7px 0 5px}
#content .du183Board .dbTop p{font-size:13px;color:var(--du-muted);margin:0}
#content .du183Board .dbDayStats{min-width:132px;padding:13px 16px;border-radius:14px;background:linear-gradient(145deg,#0d2031,#0a1825);border:1px solid var(--du-border)}
#content .du183Board .dbDayStats b{font-size:26px}
#content .du183Board .dbToolbar{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--du-border);border-radius:15px;background:rgba(12,27,41,.78);margin-bottom:12px}
#content .du183Board .dbViewTabs{display:flex;gap:7px;flex:0 0 auto}
#content .du183Board .dbToolbar>.dbV21QuickDates{display:flex;align-items:center;gap:7px;margin-left:auto;flex-wrap:nowrap}
#content .du183Board .dbV21QuickDates>.secondary{min-height:40px;padding:8px 13px}
#content .du183Board .dbV21QuickDates .dbDateNav{display:flex;align-items:center;gap:6px;margin:0}
#content .du183Board .dbDateNav input{height:40px;min-width:160px;background:#0b1b29;border-color:var(--du-border)}
#content .du183Board .dbToolbar>button.primary:last-child{min-width:98px;margin-left:8px}
#content .du183Board .dbV21Tools{display:block!important;margin:0 0 12px!important;padding:0!important;border:0!important;background:transparent!important;min-height:86px}
#content .du183Board .dbV21Tools>.dbV21QuickDates{display:none!important}
#content .du183Board .dbV21Tools>.dbV21Metrics,#content .du183Board .dbV21Tools>#dbV21FreeToggle{display:none!important}
#content .du183Board .du183Kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;width:100%}
#content .du183Board .du183Kpi{min-height:76px;display:flex;align-items:center;gap:13px;padding:13px 15px;border-radius:14px;border:1px solid var(--du-border);background:linear-gradient(145deg,#102437,#0c1c2b);box-sizing:border-box}
#content .du183Board .du183KpiIcon{width:40px;height:40px;display:grid;place-items:center;border-radius:50%;font-size:19px;font-weight:900;flex:0 0 auto}
#content .du183Board .du183Kpi.free .du183KpiIcon{color:#68e0ad;background:rgba(23,173,113,.18)}
#content .du183Board .du183Kpi.conflict .du183KpiIcon{color:#ff8787;background:rgba(230,72,72,.18)}
#content .du183Board .du183Kpi.unassigned .du183KpiIcon{color:#ffc567;background:rgba(238,153,31,.18)}
#content .du183Board .du183Kpi.transfer .du183KpiIcon{color:#78b8ff;background:rgba(38,122,230,.18)}
#content .du183Board .du183Kpi div{display:grid;gap:2px}.du183Board .du183Kpi strong{font-size:22px;line-height:1}.du183Board .du183Kpi div span{font-size:11px;color:#a6bdd2}
#content .du183Board .du183StatusStrip{border:1px solid var(--du-border)!important;background:rgba(13,29,44,.72)!important;border-radius:13px!important;min-height:42px!important;margin:0 0 10px!important;padding:8px 11px!important}
#content .du183Board .dbLayout{display:grid!important;grid-template-columns:minmax(250px,300px) minmax(540px,1fr) minmax(310px,350px)!important;gap:13px!important;align-items:start!important;min-height:510px}
#content .du183Board .dbAttention,#content .du183Board .dbSchedule,#content .du183Board #dispatchBoardDetail>.dbDetail{border:1px solid var(--du-border)!important;background:rgba(11,27,41,.84)!important;border-radius:15px!important;box-shadow:none!important}
#content .du183Board .dbAttention{padding:12px!important;position:sticky;top:8px;max-height:calc(100vh - 30px);overflow:auto}
#content .du183Board .dbAttention>.dbFilters{background:transparent!important;border:0!important;padding:0!important;margin:9px 0 12px!important;gap:7px!important}
#content .du183Board .dbAttention>.dbFilters input,#content .du183Board .dbAttention>.dbFilters select,#content .du183Board .dbAttention>.dbFilters button{min-height:40px!important;border-radius:10px!important}
#content .du183Board .dbAttentionMetrics{display:grid!important;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0 12px}
#content .du183Board .dbAttentionMetrics button{min-width:0!important;min-height:56px!important;padding:7px!important;border-radius:11px!important;background:#0d2133!important}
#content .du183Board .dbAttentionMetrics span{font-size:9px!important;color:#8ea7bd!important}#content .du183Board .dbAttentionMetrics b{font-size:18px!important}
#content .du183Board .dbTrayHead{margin:8px 0 7px}#content .du183Board .dbTray{display:grid;gap:7px;max-height:none!important;overflow:visible!important}
#content .du183Board .dbTray .dbOrderCard{position:relative;min-height:83px!important;padding:9px 9px 25px!important;border-radius:11px!important;background:#0f2234!important;border-color:rgba(117,158,197,.2)!important}
#content .du183Board .dbTray .dbOrderCard.selected{border-color:#2695ff!important;box-shadow:0 0 0 1px rgba(38,149,255,.28)!important}
#content .du183Board .du183AttentionAmount{position:absolute;right:9px;bottom:7px;font-size:11px;color:#e9f3ff}
#content .du183Board .dbDropHint{display:none!important}
#content .du183Board .dbSchedule{min-width:0;overflow:hidden;min-height:510px}
#content .du183Board .dbV94InlineList{padding:12px!important;gap:9px!important}
#content .du183Board .dbV94ListHead{padding:1px 1px 10px!important;border-bottom:1px solid rgba(137,172,206,.14)!important}
#content .du183Board .dbV94ListHead>div:first-child>b{font-size:16px}#content .du183Board .dbV94ListHead strong{font-size:21px!important}
#content .du183Board .da123Controls{padding-top:7px!important;gap:7px!important}#content .du183Board .da123Controls button{min-height:34px!important;border-radius:9px!important}
#content .du183Board .dbV94ListItems{gap:7px!important;padding-right:3px!important}
#content .du183Board .dbV94ListCard{display:grid!important;grid-template-columns:58px minmax(0,1fr) 145px!important;grid-template-rows:auto auto auto auto!important;column-gap:12px!important;row-gap:4px!important;min-height:91px!important;padding:9px 11px!important;border-radius:12px!important;border:1px solid rgba(109,156,199,.22)!important;background:#0f2335!important;color:#eef6ff!important;overflow:visible!important}
#content .du183Board .dbV94ListCard:hover{border-color:rgba(71,159,241,.65)!important;background:#112940!important}
#content .du183Board .dbV94ListCard.du183Selected{border-color:#2997ff!important;box-shadow:0 0 0 1px rgba(41,151,255,.33),0 8px 24px rgba(0,0,0,.13)!important;background:#102a42!important}
#content .du183Board .dbV94ListCard.da123Urgent{border-color:rgba(239,84,84,.55)!important;box-shadow:inset 3px 0 0 rgba(239,84,84,.8)!important}
#content .du183Board .du183Date{grid-column:1;grid-row:1/5;align-self:center;display:grid;justify-items:center;align-content:center;min-height:66px;border-right:1px solid rgba(128,166,202,.15);padding-right:10px}
#content .du183Board .du183Date b{font-size:23px;line-height:1}#content .du183Board .du183Date span{font-size:10px;color:#9cb3c8;text-transform:uppercase;margin-top:2px}#content .du183Board .du183Date small{font-size:11px;color:#c7d9e8;margin-top:5px}
#content .du183Board .dbV94ListTop{grid-column:2;grid-row:1;align-items:center!important;min-width:0}#content .du183Board .dbV94ListTop b{font-size:12px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#content .du183Board .dbV94ListWork{grid-column:2;grid-row:2;font-size:11px!important;line-height:1.35!important;color:#d9e7f4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#content .du183Board .dbV94ListMeta{grid-column:2;grid-row:3;font-size:10px!important;color:#8faac0!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#content .du183Board .da123Badges{grid-column:2;grid-row:4;margin:1px 0 0!important}
#content .du183Board .du183CardSide{grid-column:3;grid-row:1/5;display:grid;grid-template-columns:1fr auto;grid-template-rows:auto 1fr;align-items:center;gap:4px 8px;min-width:0}
#content .du183Board .du183Master{grid-column:1/3;font-size:10px;color:#a8bfd3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
#content .du183Board .du183Amount{font-size:13px;justify-self:end;color:#f5f9ff}.du183Board .du183Chevron{font-size:22px;color:#7b9cb9;justify-self:end}
#content .du183Board .du183Status{font-size:9px!important;padding:4px 7px!important;border-radius:999px!important}.du183Board .du183Status.danger{color:#ff9a9a;background:rgba(224,67,67,.18)}.du183Board .du183Status.warn{color:#ffd171;background:rgba(227,151,32,.18)}.du183Board .du183Status.ok,.du183Board .du183Status.done{color:#6ee0b0;background:rgba(28,171,115,.18)}.du183Board .du183Status.work{color:#8fc2ff;background:rgba(42,119,222,.2)}.du183Board .du183Status.away{color:#ffc16b;background:rgba(216,133,26,.2)}
#content .du183Board #dispatchBoardDetail{min-width:0}#content .du183Board #dispatchBoardDetail>.dbDetail{position:sticky;top:8px;padding:12px!important;max-height:calc(100vh - 24px);overflow:auto}
#content .du183Board .dbDetail>.dbPanelHead{padding-bottom:10px;border-bottom:1px solid rgba(130,166,199,.12)}#content .du183Board .dbDetail>.dbPanelHead h3{font-size:18px!important;margin-top:5px!important}.du183Board .dbDetail>.dbPanelHead>b{font-size:15px!important}
#content .du183Board .du183PriorityAlert{display:grid;gap:3px;margin:10px 0;padding:10px 11px;border-radius:11px;border:1px solid rgba(237,89,89,.48);background:rgba(203,57,57,.12)}#content .du183Board .du183PriorityAlert.warn{border-color:rgba(236,166,53,.43);background:rgba(212,139,27,.1)}#content .du183Board .du183PriorityAlert b{font-size:12px}.du183Board .du183PriorityAlert span{font-size:10px;line-height:1.35;color:#b8c9d7}
#content .du183Board .dbDetailGrid{gap:7px!important;margin-top:10px!important}.du183Board .dbDetailGrid>div{background:#0d2031!important;border-radius:10px!important;padding:9px!important}.du183Board .dbDetailGrid span{font-size:9px!important}.du183Board .dbDetailGrid b{font-size:11px!important;line-height:1.35}
#content .du183Board .dbDetailActions{display:grid!important;grid-template-columns:1fr 1fr;gap:7px!important;margin-top:10px}.du183Board .dbDetailActions>*{min-height:40px!important;margin:0!important}.du183Board .dbQuickAssign{margin-top:9px!important;padding:10px!important;border-radius:11px!important;background:#0d2031!important}
}
@media(min-width:1050px) and (max-width:1280px){#content .du183Board .dbLayout{grid-template-columns:245px minmax(460px,1fr) 300px!important}#content .du183Board .du183Kpis{grid-template-columns:repeat(2,1fr)}#content .du183Board .dbV94ListCard{grid-template-columns:50px minmax(0,1fr) 118px!important}}
`;
document.head.appendChild(style);
})();