(()=>{
'use strict';
if(window.BOS_MASTER_UPCOMING_CLAIMS_V111)return;window.BOS_MASTER_UPCOMING_CLAIMS_V111=true;

const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const liveUser=()=>typeof liveMasterUser==='function'?liveMasterUser():(state?.user||{});
const escv=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const moneyv=v=>typeof money==='function'?money(v):`${Math.round(Number(v)||0).toLocaleString('ru-RU')} ₽`;
const dateOnly=v=>String(v||'').slice(0,10);

function masterIds(){
  const u=liveUser()||{},out=new Set([u.id,u.staff_id,u.master_id,u.vk_user_id,u.external_id].filter(Boolean).map(String));
  if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof ownOrders==='function'){
    for(const o of ownOrders()||[])[o?.master_staff_id,o?.master_id,o?.master_vk_id,o?.staff_id].filter(Boolean).map(String).forEach(x=>out.add(x));
  }
  const rows=[...(state?.masters||[]),...(state?.users||[])];
  for(const m of rows){
    const vals=[m?.id,m?.staff_id,m?.master_id,m?.vk_user_id,m?.external_id].filter(Boolean).map(String);
    if(vals.some(x=>out.has(x)))vals.forEach(x=>out.add(x));
  }
  return out;
}
function mine(c){
  const values=[c?.master_staff_id,c?.master_id,c?.master_vk_id,c?.staff_id,c?.vk_user_id,c?.external_id].filter(Boolean).map(String),ids=masterIds();
  return values.length?values.some(x=>ids.has(x)):String(state?.user?.role||'')==='master';
}
function linkedOrder(c){
  const id=String(c?.order_id||'');
  return (state?.orders||[]).find(o=>String(o?.supabase_id||o?.id)===id)||(state?.supabaseOrders||[]).find(o=>String(o?.id)===id)||null;
}
function orderNo(o,c){
  const ext=String(o?.external_id||'');
  if(ext.startsWith('hands:'))return ext.slice(6);
  return String(o?.id||c?.order_id||'');
}
function claimText(c){return String(c?.required_work||c?.reason||'Повторный выезд').replace(/\s+/g,' ').trim()}
function claimMeta(c){
  const d=dateOnly(c?.scheduled_date),t=String(c?.scheduled_time||'').slice(0,5),when=[d||'Дата не назначена',t].filter(Boolean).join(' · ');
  const pay=c?.pay_revisit?`Оплата ${moneyv(c?.revisit_payment||0)}`:'Без оплаты';
  return `${when} · ${pay}`;
}
function openAction(c,o){return o&&typeof window.openOrder==='function'?`openOrder('${escv(o.id)}')`:`openClaimDetails('${escv(c.id)}')`}
function existingCard(o){
  if(!o)return null;
  const id=String(o.id);
  return [...document.querySelectorAll('.bosMasterUpcomingCard')].find(card=>!card.closest('.bosMasterClaimDay')&&String(card.getAttribute('onclick')||'').includes(`'${id}'`))||null;
}
function decorate(card,c){
  if(!card)return false;
  card.classList.add('bosMasterUpcomingClaim');
  card.dataset.claimId=String(c.id||'');
  const no=card.querySelector('.bosUpcomingNo');
  if(no&&!no.querySelector('.bosUpcomingClaimBadge'))no.insertAdjacentHTML('beforeend',' <span class="bosUpcomingClaimBadge">Рекламация</span>');
  const work=card.querySelector('.bosUpcomingWork');if(work)work.textContent=claimText(c);
  const meta=card.querySelector('.bosUpcomingMeta');if(meta)meta.textContent=claimMeta(c);
  return true;
}
function claimCard(c){
  const o=linkedOrder(c),no=orderNo(o,c);
  return `<button type="button" class="bosMasterUpcomingCard bosMasterUpcomingClaim" data-claim-id="${escv(c.id)}" onclick="${openAction(c,o)}"><strong class="bosUpcomingNo">№ ${escv(no)} <span class="bosUpcomingClaimBadge">Рекламация</span></strong><span class="bosUpcomingWork">${escv(claimText(c))}</span><small class="bosUpcomingMeta">${escv(claimMeta(c))}</small></button>`;
}
function upcomingSection(){
  const root=document.getElementById('content');if(!root)return null;
  const h=[...root.querySelectorAll('h2,h3')].find(x=>(x.textContent||'').trim()==='Ближайшие заявки');
  return h?.closest('section')||h?.parentElement||null;
}
function ensureDays(claims){
  let days=document.querySelector('.bosMasterUpcomingDays');
  if(days||!claims.length)return days;
  const section=upcomingSection(),empty=section?.querySelector('.masterEmpty');
  if(!section||!empty)return null;
  days=document.createElement('div');
  days.className='bosMasterUpcomingDays';
  days.dataset.bosClaimsOnly='1';
  empty.replaceWith(days);
  return days;
}
function restoreEmpty(days){
  if(!days||days.dataset.bosClaimsOnly!=='1')return;
  if(days.querySelector('.bosMasterUpcomingCard:not(.bosMasterUpcomingClaim)'))return;
  const empty=document.createElement('div');
  empty.className='masterEmpty';
  empty.textContent='Ближайших выездов пока нет';
  days.replaceWith(empty);
}
function renderClaims(){
  if(!masterMode()||String(state?.page||'')!=='home')return;
  const claims=(state?.claims||[]).filter(c=>String(c?.status||'')==='open'&&mine(c)).sort((a,b)=>String((a.scheduled_date||'0000')+(a.scheduled_time||'00:00')).localeCompare(String((b.scheduled_date||'0000')+(b.scheduled_time||'00:00'))));
  const days=ensureDays(claims);if(!days)return;
  const sig=JSON.stringify(claims.map(c=>[c.id,c.order_id,c.status,c.scheduled_date,c.scheduled_time,c.reason,c.required_work,c.pay_revisit,c.revisit_payment]));
  const needsDecorate=claims.some(c=>{const card=existingCard(linkedOrder(c));return card&&String(card.dataset.claimId||'')!==String(c.id||'')});
  if(days.dataset.bosClaimsSig===sig&&!needsDecorate)return;
  days.querySelector('.bosMasterClaimDay')?.remove();
  if(!claims.length){days.dataset.bosClaimsSig=sig;restoreEmpty(days);return}
  const extra=[];
  for(const c of claims){const o=linkedOrder(c),card=existingCard(o);if(!decorate(card,c))extra.push(c)}
  if(extra.length){
    const group=document.createElement('div');group.className='bosMasterUpcomingDay bosMasterClaimDay';
    group.innerHTML=`<div class="bosMasterUpcomingDayHead"><b>Рекламации</b><span>${extra.length}</span></div>${extra.map(claimCard).join('')}`;
    days.prepend(group);
  }
  days.dataset.bosClaimsSig=sig;
}

const baseRefresh=window.refreshClaims;
if(typeof baseRefresh==='function')window.refreshClaims=async function(){const out=await baseRefresh.apply(this,arguments);setTimeout(renderClaims,0);return out};
const baseShow=window.show;
if(typeof baseShow==='function')window.show=function(){const out=baseShow.apply(this,arguments);setTimeout(renderClaims,0);setTimeout(renderClaims,100);return out};
let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;renderClaims()})});
const root=document.getElementById('content');if(root)observer.observe(root,{childList:true,subtree:true});
setTimeout(renderClaims,0);setTimeout(renderClaims,900);

const style=document.createElement('style');style.textContent=`
.bosMasterClaimDay{border-color:rgba(239,68,68,.34)!important;background:rgba(239,68,68,.045)!important}
.bosMasterUpcomingClaim{border-color:rgba(239,68,68,.34)!important}
.bosUpcomingClaimBadge{display:inline-flex;padding:2px 5px;margin-left:3px;border-radius:999px;background:rgba(239,68,68,.14);color:#ff8585;font-size:9px;font-weight:900;vertical-align:1px}
.bosMasterUpcomingClaim .bosUpcomingWork{color:var(--text,#eef4fb)!important}
`;
document.head.appendChild(style);
})();
