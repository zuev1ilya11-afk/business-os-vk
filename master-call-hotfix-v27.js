(()=>{
'use strict';
if(window.BOS_MASTER_CALL_HOTFIX_V27)return;window.BOS_MASTER_CALL_HOTFIX_V27=true;
const isMaster=()=>String(state?.user?.role||'')==='master'||(typeof liveMasterMode==='function'&&liveMasterMode());
const findOrder=id=>(state?.orders||[]).find(o=>String(o.id)===String(id))||null;
function normalizePhone(v){let p=String(v||'').trim().replace(/[^\d+]/g,'');if(/^8\d{10}$/.test(p))p='+7'+p.slice(1);else if(/^\d{10}$/.test(p))p='+7'+p;return p}
function currentOrderId(){const modal=document.querySelector('#modalRoot .modal');return String(modal?.dataset?.bosWorkflowOrderId||modal?.querySelector('.bosMasterWorkflow')?.dataset?.orderId||'')}
function setMsg(id,text){const modal=document.querySelector('#modalRoot .modal');if(!modal)return;const marked=String(modal.dataset.bosWorkflowOrderId||modal.querySelector('.bosMasterWorkflow')?.dataset?.orderId||'');if(id&&marked&&String(id)!==marked)return;const el=modal.querySelector('.bosMasterWorkflow .bosMwMsg');if(el)el.textContent=text||''}
function inVk(){try{const q=new URLSearchParams(location.search);if(q.has('vk_app_id')||q.has('vk_user_id'))return true;if(window.vkBridge&&typeof window.vkBridge.send==='function')return true;if(document.referrer){const h=new URL(document.referrer).hostname;if(h==='vk.com'||h.endsWith('.vk.com'))return true}}catch(_){}return false}
function helperUrl(phone){const u=new URL('./call-client.html',location.href);u.search='';u.hash='';u.searchParams.set('phone',phone);return u.href}
async function openVkUrl(url){try{if(window.vkBridge&&typeof window.vkBridge.send==='function'){await window.vkBridge.send('VKWebAppOpenURL',{url});return true}}catch(_){}return false}
async function copyPhone(phone,id){try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(phone);setMsg(id,`VK не открыл телефон. Номер скопирован: ${phone}`);return}}catch(_){}setMsg(id,`Телефон клиента: ${phone}`)}
const originalReload=typeof window.reloadData==='function'?window.reloadData:null;
if(originalReload&&!window.BOS_MASTER_RELOAD_WRAP_V27){window.BOS_MASTER_RELOAD_WRAP_V27=true;window.reloadData=function(){if(Date.now()<Number(window.BOS_SKIP_MASTER_REFRESH_UNTIL||0))return Promise.resolve({ok:true,skippedAfterCall:true});return originalReload.apply(this,arguments)}}
window.masterWorkflowCallClient=async function(id,rawPhone){const order=findOrder(id),phone=normalizePhone(rawPhone||order?.phone||order?.client_phone);if(!phone){setMsg(id,'У клиента не указан телефон');return false}setMsg(id,'');window.BOS_SKIP_MASTER_REFRESH_UNTIL=Date.now()+15000;if(inVk()){const url=helperUrl(phone);if(await openVkUrl(url))return false;try{const w=window.open(url,'_blank','noopener,noreferrer');if(w)return false}catch(_){}await copyPhone(phone,id);return false}try{window.location.href=`tel:${phone}`}catch(_){await copyPhone(phone,id)}return false};
document.addEventListener('click',event=>{if(!isMaster())return;const target=event.target?.closest?.('.bosMwCallAction,.bosClientCallAction');if(!target)return;event.preventDefault();event.stopImmediatePropagation();const id=currentOrderId();const href=String(target.getAttribute('href')||'').replace(/^tel:/i,''),order=findOrder(id),phone=href||order?.phone||order?.client_phone||'';window.masterWorkflowCallClient(id,phone)},true);
})();
