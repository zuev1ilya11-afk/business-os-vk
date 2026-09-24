(()=>{
'use strict';
if(window.BOS_MASTER_HOME_ORDERS_V124)return;

let queued=false;
const masterMode=()=>String(state?.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview())||(typeof liveMasterMode==='function'&&liveMasterMode());
const orderById=id=>(state?.orders||[]).find(o=>String(o?.id)===String(id))||null;
const workSource=o=>String(o?.work||o?.services_text||o?.description||o?.service_name||o?.service||'').trim();

function orderIdFromCard(card){
  const direct=String(card?.dataset?.orderId||'').trim();
  if(direct)return direct;
  const hit=String(card?.getAttribute?.('onclick')||'').match(/openOrder\(['"]([^'"]+)/);
  return hit?String(hit[1]):'';
}
function qtyFrom(line){
  const m=String(line||'').match(/[×x]\s*([\d]+(?:[.,]\d+)?)/i);
  if(!m)return{value:1,explicit:false};
  const n=Number(String(m[1]).replace(',','.'));
  return{value:Number.isFinite(n)&&n>0?n:1,explicit:true};
}
function cleanTitle(line){
  return String(line||'')
    .replace(/\s*[×x]\s*[\d]+(?:[.,]\d+)?\s*(?:шт\.?|piece|pcs|комплект\w*|п\.?м\.?|м|км)?\s*$/i,'')
    .replace(/\s+—\s+.*$/,'')
    .replace(/\s+/g,' ')
    .trim();
}
function classify(title){
  const t=String(title||'').toLowerCase().replace(/ё/g,'е');
  if(!t)return'';
  if(/подрезк/.test(t)||/(?:^|\s)доп\.?\s*работ/.test(t)||/дополнительн\w*\s+работ/.test(t))return'';
  if(/минимальн\w*\s+стоимост/.test(t))return'Мин. стоимость';
  if(/римск\w*\s+штор/.test(t))return'Римские шторы';
  if(/рулонн\w*\s+штор|день[\s-]*ночь/.test(t))return'Шторы';
  if(/плиссе/.test(t))return'Плиссе';
  if(/жалюз/.test(t))return'Жалюзи';
  if(/карниз/.test(t))return'Карниз';
  if(/замер/.test(t))return'Замер';
  if(/штор/.test(t))return'Шторы';
  return cleanTitle(title)
    .replace(/^(?:монтаж|установка)\s+/i,'')
    .replace(/^(?:демонтаж)\s+/i,'Демонтаж ')
    .trim();
}
function summarize(order){
  const source=workSource(order);
  if(!source)return'Работы не указаны';
  const raw=source.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const items=[];
  for(const line of raw){
    const title=cleanTitle(line),label=classify(title);
    if(!label)continue;
    const qty=qtyFrom(line);
    let item=items.find(x=>x.label===label);
    if(!item){item={label,qty:0,explicit:false};items.push(item)}
    if(qty.explicit){item.qty+=qty.value;item.explicit=true}
  }
  if(!items.length)return'Работы указаны в карточке';
  return items.slice(0,3).map(item=>{
    if(item.label==='Мин. стоимость')return item.label;
    if(item.explicit&&item.qty>1)return `${item.label} ×${Number.isInteger(item.qty)?item.qty:String(item.qty).replace('.',',')}`;
    return item.label;
  }).join(' · ');
}
function decorateUpcoming(){
  if(!masterMode())return;
  document.querySelectorAll('.bosMasterUpcomingCard').forEach(card=>{
    const id=orderIdFromCard(card),order=orderById(id),work=card.querySelector('.bosUpcomingWork');
    if(!id||!order||!work)return;
    card.dataset.orderId=id;
    const text=summarize(order);
    if(work.textContent!==text)work.textContent=text;
  });
}
function decorateToday(){
  if(!masterMode())return;
  document.querySelectorAll('.bosMwTodayCard').forEach(card=>{
    const id=orderIdFromCard(card);if(id)card.dataset.orderId=id;
  });
}
function decorate(){queued=false;decorateUpcoming();decorateToday()}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(decorate)}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('resize',schedule);
setTimeout(schedule,0);
window.BOS_MASTER_HOME_ORDERS_V124={summarize,refresh:schedule};

const style=document.createElement('style');
style.textContent=`
#content .bosMwTodayTime,#content .bosMwTodayStage,#content .mwv2TodayStage,#content .masterV99Status,#content .masterJobTime{word-break:normal!important;overflow-wrap:normal!important}
#content .bosMwTodayTime{white-space:nowrap!important;min-width:max-content}
#content .bosMwTodayStage,#content .mwv2TodayStage{white-space:nowrap!important;max-width:none!important}
#content .bosMasterUpcomingCard .bosUpcomingWork{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;word-break:normal;overflow-wrap:normal}
@media(max-width:520px){
  #content .bosMwTodayCard{grid-template-columns:64px minmax(0,1fr)!important;column-gap:10px!important;align-items:start!important}
  #content .bosMwTodayTime{grid-column:1;grid-row:1;align-self:start}
  #content .bosMwTodayMain{grid-column:2;grid-row:1;min-width:0}
  #content .bosMwTodayStage,#content .mwv2TodayStage{grid-column:2!important;grid-row:auto!important;justify-self:start!important;margin-top:4px}
  #content .bosMwTodayMain>b{overflow-wrap:break-word!important;word-break:normal!important}
}
`;
document.head.appendChild(style);
})();
