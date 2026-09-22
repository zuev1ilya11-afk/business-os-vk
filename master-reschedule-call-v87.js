(()=>{
'use strict';
if(window.BOS_MASTER_RESCHEDULE_CALL_V87)return;
window.BOS_MASTER_RESCHEDULE_CALL_V87=true;

const PROFILE_URL='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/profile-self-api';
const getOrder=id=>(state?.orders||[]).find(x=>String(x.id)===String(id));
const storedSession=()=>{try{return sessionStorage.getItem('bos_vk_session_v2')||localStorage.getItem('bos_vk_session_v2')||''}catch(_){return ''}};
const clearSession=()=>{try{sessionStorage.removeItem('bos_vk_session_v2');localStorage.removeItem('bos_vk_session_v2')}catch(_){}};

async function authHeaders(){
  let token=storedSession();
  if(!token&&window.BOS_ENSURE_VK_SESSION){
    try{await window.BOS_ENSURE_VK_SESSION();token=storedSession()}catch(_){}
  }
  if(!token)throw new Error('Доступ не подтверждён');
  const h={'Content-Type':'application/json','X-BOS-Session':token};
  let launch=window.BOS_VK_LAUNCH_PARAMS||'';
  if(!launch&&window.BOS_ENSURE_VK_LAUNCH_PARAMS){
    try{launch=await window.BOS_ENSURE_VK_LAUNCH_PARAMS()}catch(_){}
  }
  if(launch)h['X-VK-Launch-Params']=launch;
  return h;
}

async function profileRequest(body){
  let lastErr;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
      try{
        const r=await fetch(PROFILE_URL,{method:'POST',headers:await authHeaders(),body:JSON.stringify(body),signal:controller.signal});
        const d=await r.json().catch(()=>({}));
        if(r.status===401&&attempt===0){
          clearSession();
          if(window.BOS_ENSURE_VK_SESSION){try{await window.BOS_ENSURE_VK_SESSION()}catch(_){}}
          lastErr=new Error(d.error||'Доступ не подтверждён');
          continue;
        }
        if(!r.ok||!d.ok){
          const e=new Error(d.error||`Ошибка сервера (${r.status})`);
          e.status=r.status;
          throw e;
        }
        return d;
      }finally{clearTimeout(timer)}
    }catch(e){
      lastErr=e;
      if(e?.name==='AbortError')lastErr=new Error('Сервер не ответил. Повторите ещё раз.');
      if(attempt===0)await new Promise(r=>setTimeout(r,350));
    }
  }
  throw lastErr||new Error('Не удалось отправить запрос');
}

function masterUser(){
  if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof liveMasterUser==='function')return liveMasterUser()||{};
  return state?.user||{};
}

function rescheduleBody(id,reason){
  const m=masterUser(),phone=String(m?.phone||'').trim();
  if(!phone)throw new Error('У мастера не указан телефон в профиле');
  const body={phone,district:`@@BOS_R1@@|${id}|${reason}`};
  if(typeof isMasterPreview==='function'&&isMasterPreview())body.acting_master_vk_id=m?.vk_user_id||m?.external_id||m?.id||'';
  return body;
}

function telValue(raw){
  const source=String(raw||'').trim(),digits=source.replace(/\D/g,'');
  if(!digits)return'';
  if(digits.length===11&&digits.startsWith('8'))return'+7'+digits.slice(1);
  if(digits.length===10)return'+7'+digits;
  if(source.startsWith('+'))return'+'+digits;
  return digits;
}

function modalRoot(){return document.querySelector('#modalRoot .modal')||document.querySelector('#modalRoot')}

function injectCall(id){
  const o=getOrder(id),phone=String(o?.phone||o?.client_phone||'').trim(),tel=telValue(phone),modal=modalRoot();
  if(!o||!phone||!tel||!modal||modal.querySelector('.bosClientCallAction'))return;
  let target=[...modal.querySelectorAll('small')].find(el=>(el.textContent||'').trim()===phone)?.parentElement;
  target=target||[...modal.querySelectorAll('.bosOrderFact')].find(el=>(el.textContent||'').includes(phone));
  target=target||[...modal.querySelectorAll('p,div')].find(el=>el.children.length<4&&(el.textContent||'').includes(phone));
  if(!target)return;
  target.classList.add('bosClientPhoneRow');
  const a=document.createElement('a');
  a.className='secondary bosClientCallAction';
  a.href=`tel:${tel}`;
  a.textContent='Позвонить';
  a.setAttribute('aria-label',`Позвонить клиенту ${phone}`);
  a.onclick=e=>e.stopPropagation();
  target.appendChild(a);
}

function injectRescheduleNotice(id){
  const o=getOrder(id),modal=modalRoot();
  if(!o?.reschedule_requested||!modal||modal.querySelector('.bosRescheduleNotice'))return;
  const box=document.createElement('div');
  box.className='bosRescheduleNotice';
  const reason=String(o.reschedule_reason||'').trim();
  box.innerHTML=`<b>Перенос запрошен</b>${reason?`<span>Причина: ${esc(reason)}</span>`:''}`;
  const anchor=modal.querySelector('.bosOrderHead,.bosHandsHead,h2');
  if(anchor)anchor.insertAdjacentElement('afterend',box);else modal.prepend(box);
}

function injectOrderExtras(id){injectCall(id);injectRescheduleNotice(id)}

const baseOpenOrder=window.openOrder;
if(typeof baseOpenOrder==='function')window.openOrder=function(id){
  const out=baseOpenOrder.apply(this,arguments);
  setTimeout(()=>injectOrderExtras(id),0);
  setTimeout(()=>injectOrderExtras(id),80);
  return out;
};

function injectReportAction(id){
  const form=document.querySelector('#masterReportForm');
  if(!form||form.querySelector('.bosRescheduleAction'))return;
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='secondary wide bosRescheduleAction';
  btn.textContent='Нужно перенести';
  btn.onclick=()=>window.openMasterRescheduleForm(id);
  const submit=form.querySelector('button[type="submit"]');
  if(submit)submit.insertAdjacentElement('afterend',btn);else form.appendChild(btn);
  const o=getOrder(id);
  if(o?.reschedule_requested){
    const p=document.createElement('p');
    p.className='muted bosRescheduleExisting';
    p.textContent=o.reschedule_reason?`Перенос уже запрошен: ${o.reschedule_reason}`:'Перенос уже запрошен';
    btn.insertAdjacentElement('afterend',p);
  }
}

const baseOpenReport=window.openMasterReportForm;
if(typeof baseOpenReport==='function')window.openMasterReportForm=function(id){
  const out=baseOpenReport.apply(this,arguments);
  setTimeout(()=>injectReportAction(id),0);
  setTimeout(()=>injectReportAction(id),50);
  return out;
};

function markRescheduleModal(){
  const modal=modalRoot();
  if(!modal)return;
  modal.classList.add('bosRescheduleSheet');
  modal.closest('.modalBackdrop')?.classList.add('bosRescheduleBackdrop');
}

window.openMasterRescheduleForm=function(id){
  const o=getOrder(id);
  if(!o)return;
  const current=String(o.reschedule_reason||'').slice(0,80);
  openModal(`<h2>Нужно перенести заявку ${esc(o.id)}</h2><p class="muted bosRescheduleHint">Укажите причину переноса</p><form id="masterRescheduleForm" class="form"><label for="masterRescheduleReason">Причина переноса *</label><textarea id="masterRescheduleReason" name="reason" maxlength="80" rows="4" required placeholder="Напишите, почему заявку нужно перенести">${esc(current)}</textarea><small class="muted">До 80 символов</small><button class="primary wide" type="submit">Отправить запрос на перенос</button><button class="secondary wide" type="button" onclick="openMasterReportForm('${esc(o.id)}')">Отмена</button><p id="masterRescheduleMsg" class="muted"></p></form>`);
  markRescheduleModal();
  const form=document.querySelector('#masterRescheduleForm'),reason=document.querySelector('#masterRescheduleReason');
  setTimeout(()=>reason?.focus(),0);
  form.onsubmit=async e=>{
    e.preventDefault();
    if(state.busy)return;
    const value=String(reason?.value||'').replace(/\s+/g,' ').trim(),msg=document.querySelector('#masterRescheduleMsg');
    if(value.length<3){msg.textContent='Укажите причину переноса';return}
    if(value.length>80){msg.textContent='Причина должна быть не длиннее 80 символов';return}
    state.busy=true;
    setBusy(form,true);
    msg.textContent='Отправляем запрос…';
    try{
      await profileRequest(rescheduleBody(o.id,value));
      const i=(state.orders||[]).findIndex(x=>String(x.id)===String(o.id));
      if(i>=0)state.orders[i]={...state.orders[i],reschedule_requested:true,reschedule_reason:value,reschedule_requested_at:new Date().toISOString(),reschedule_requested_by:masterUser()?.id||null};
      msg.textContent='Запрос на перенос отправлен';
      state.busy=false;
      closeModal();
      show('orders');
    }catch(err){
      msg.textContent=err?.message||String(err);
      setBusy(form,false);
      state.busy=false;
    }
  };
};

const style=document.createElement('style');
style.textContent=`
.bosClientPhoneRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bosClientCallAction{display:inline-flex!important;align-items:center;justify-content:center;width:max-content;min-height:40px;padding:7px 12px;margin:0;text-decoration:none;font-size:12px;white-space:nowrap}
.bosHandsBlock .bosClientCallAction{margin-left:0}
.bosRescheduleAction{margin-top:8px!important}
.bosRescheduleExisting{margin:4px 0 0;font-size:12px}
.bosRescheduleNotice{display:grid;gap:3px;margin:8px 0 10px;padding:10px 12px;border:1px solid rgba(242,176,65,.38);border-radius:12px;background:rgba(242,176,65,.10)}
.bosRescheduleNotice b{font-size:13px}
.bosRescheduleNotice span{font-size:12px;line-height:1.35;overflow-wrap:anywhere}
.bosRescheduleSheet{width:min(100%,520px)}
.bosRescheduleHint{margin-top:-4px}
#masterRescheduleReason{min-height:100px;resize:vertical}
@media(max-width:520px){
  .bosClientCallAction{min-height:44px;padding:8px 14px}
  .bosRescheduleNotice{margin-top:6px}
  .modalBackdrop.bosRescheduleBackdrop{align-items:flex-end!important;padding:0!important}
  .modal.bosRescheduleSheet{width:100%!important;max-width:none!important;margin:0!important;border-radius:20px 20px 0 0!important;max-height:86vh;overflow:auto;padding-bottom:max(18px,env(safe-area-inset-bottom))!important}
  #masterRescheduleReason{font-size:16px}
}
`;
document.head.appendChild(style);
})();
