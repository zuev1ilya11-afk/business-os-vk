(function(root){
'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LABELS={
 pending:'Итог звонка не указан',
 no_answer:'Не дозвонился',
 thinking:'Клиент думает',
 waiting_delivery:'Ждёт доставку',
 call_later:'Перезвонить позже',
 agreed:'Договорились',
 other:'Другое'
};
function time(value){
 if(!value)return'';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return'';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${parts.day}.${parts.month}, ${parts.hour}:${parts.minute}`;
}
const history=order=>Array.isArray(order?.master_contact_history)?order.master_contact_history.filter(x=>x&&typeof x==='object'):[];
const latest=order=>{const h=history(order);return h[h.length-1]||null};
const confirmed=order=>!!time(order?.master_called_at)&&!!order?.master_called_by_staff_id&&!!String(order?.master_called_by_name||'').trim();
const tone=result=>result==='agreed'?'confirmed':result==='no_answer'?'attention':result==='pending'?'legacy':['thinking','waiting_delivery','call_later','other'].includes(result)?'info':'unconfirmed';
function eventHtml(event){
 const label=LABELS[String(event?.result||'')]||'Звонок';
 const at=time(event?.result_at||event?.at),phone=String(event?.phone||'').trim(),comment=String(event?.comment||'').trim(),author=String(event?.by_name||'').trim(),callback=time(event?.callback_at);
 return `<div class="bosContactEvent ${tone(String(event?.result||''))}"><div class="bosContactEventTop"><b>${escape(label)}</b><span>${escape(at||'—')}</span></div><div class="bosContactEventPhone">${escape(phone||'Номер не указан')}</div>${comment?`<div class="bosContactEventComment">${escape(comment)}</div>`:''}${callback?`<div class="bosContactEventCallback">Перезвонить: ${escape(callback)}</div>`:''}${author?`<small>${escape(author)}</small>`:''}</div>`;
}
function html(order,{details=false}={}){
 const event=latest(order);
 if(event){
  const result=String(event.result||'pending'),label=LABELS[result]||'Звонок',at=time(event.result_at||event.at),phone=String(event.phone||'').trim(),comment=String(event.comment||'').trim();
  const summary=`<span class="bosContactStatus ${tone(result)}">${escape(label)}${at?' · '+escape(at):''}${phone?' · '+escape(phone):''}</span>`;
  if(!details)return summary;
  const events=history(order).slice(-50).reverse();
  return summary+`${comment?`<small class="bosContactLatestComment">${escape(comment)}</small>`:''}<div class="bosContactHistory"><b>История связи</b>${events.map(eventHtml).join('')}</div>`;
 }
 const at=time(order?.master_called_at),proven=confirmed(order),legacy=!!order?.master_called_at;
 const label=proven?'Связался':legacy?'Звонок отмечен':'Связь не подтверждена';
 const author=proven?String(order.master_called_by_name).trim():'';
 return `<span class="bosContactStatus ${proven?'confirmed':legacy?'legacy':'unconfirmed'}"${author?` title="Подтвердил мастер: ${escape(author)}"`:''}>${label}${at?' · '+escape(at):''}</span>${details&&author?`<small class="bosContactAuthor">Подтвердил мастер: ${escape(author)}</small>`:''}`;
}
const api={html,confirmed,time,history,latest,labels:LABELS};root.BOS_CONTACT_STATUS=api;
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof document!=='undefined'){
 const style=document.createElement('style');style.textContent=`
 .bosContactStatus{display:block;font-size:12px;line-height:1.4;color:var(--muted,#91a3b7);font-weight:600;white-space:normal;overflow-wrap:anywhere}
 .bosContactStatus.confirmed{color:#76c9a0}.bosContactStatus.attention{color:#f5a524}.bosContactStatus.info{color:#70b7ff}
 .bosContactAuthor,.bosContactLatestComment{display:block;font-size:11px;line-height:1.4;color:var(--muted,#91a3b7);overflow-wrap:anywhere;margin-top:3px}
 .bosMasterClientActions>.bosContactStatus,.bosMasterClientActions>.bosContactAuthor{flex-basis:100%}
 .bosContactHistory{display:grid;gap:7px;margin-top:9px;max-height:480px;overflow:auto;overscroll-behavior:contain}.bosContactHistory>b{font-size:11px;color:var(--muted,#91a3b7);text-transform:uppercase;letter-spacing:.05em}
 .bosContactEvent{padding:9px 10px;border:1px solid rgba(127,127,127,.16);border-radius:10px;background:rgba(127,127,127,.04);min-width:0}
 .bosContactEventTop{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.bosContactEventTop b{font-size:12px}.bosContactEventTop span,.bosContactEvent small{font-size:10px;color:var(--muted,#91a3b7)}
 .bosContactEventPhone{font-size:12px;font-weight:700;margin-top:3px}.bosContactEventComment,.bosContactEventCallback{font-size:11px;line-height:1.4;margin-top:3px;overflow-wrap:anywhere}
 `;document.head.appendChild(style);
}
})(typeof window==='object'?window:globalThis);
