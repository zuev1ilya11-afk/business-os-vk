(function(root){
'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function time(value){
 if(!value)return'';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return'';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${parts.day}.${parts.month}, ${parts.hour}:${parts.minute}`;
}
const confirmed=order=>!!time(order?.master_called_at)&&!!order?.master_called_by_staff_id&&!!String(order?.master_called_by_name||'').trim();
function html(order,{details=false}={}){
 const at=time(order?.master_called_at),proven=confirmed(order),legacy=!!order?.master_called_at;
 const label=proven?'Связался':legacy?'Звонок отмечен':'Связь не подтверждена';
 const author=proven?String(order.master_called_by_name).trim():'';
 return `<span class="bosContactStatus ${proven?'confirmed':legacy?'legacy':'unconfirmed'}"${author?` title="Подтвердил мастер: ${escape(author)}"`:''}>${label}${at?' · '+escape(at):''}</span>${details&&author?`<small class="bosContactAuthor">Подтвердил мастер: ${escape(author)}</small>`:''}`;
}
const api={html,confirmed,time};root.BOS_CONTACT_STATUS=api;
if(typeof module==='object'&&module.exports)module.exports=api;
if(typeof document!=='undefined'){
 const style=document.createElement('style');style.textContent='.bosContactStatus{display:block;font-size:12px;line-height:1.4;color:var(--muted,#91a3b7);font-weight:500;white-space:normal;overflow-wrap:anywhere}.bosContactStatus.confirmed{color:#76c9a0}.bosContactAuthor{display:block;font-size:11px;line-height:1.4;color:var(--muted,#91a3b7);overflow-wrap:anywhere}.bosMasterClientActions>.bosContactStatus,.bosMasterClientActions>.bosContactAuthor{flex-basis:100%}';document.head.appendChild(style);
}
})(typeof window==='object'?window:globalThis);
