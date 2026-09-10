(()=>{
'use strict';
const PROFILE_API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/profile-self-api';
function masterEditLive(){return typeof liveMasterMode==='function'&&liveMasterMode()}
function masterEditUser(){return typeof liveMasterUser==='function'?liveMasterUser():(state.user||{})}
function masterEditIds(u){return [u?.id,u?.staff_id,u?.vk_user_id,u?.external_id].filter(Boolean).map(String)}
function masterEditCurrentDistrict(){const u=masterEditUser(),ids=new Set(masterEditIds(u)),m=(state.masters||[]).find(x=>masterEditIds(x).some(id=>ids.has(id)));return u?.district||m?.district||''}
function patchMasterState(user){
  if(!user)return;
  const ids=new Set(masterEditIds(user));
  if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof previewUser!=='undefined'&&previewUser){previewUser={...previewUser,...user}}
  else if(state.user)state.user={...state.user,...user};
  state.users=(state.users||[]).map(x=>masterEditIds(x).some(id=>ids.has(id))?{...x,...user}:x);
  state.masters=(state.masters||[]).map(x=>masterEditIds(x).some(id=>ids.has(id))?{...x,...user}:x);
}
async function profileHeaders(){
  const raw=window.BOS_AUTH_HEADERS?await window.BOS_AUTH_HEADERS():{};
  const h={'Content-Type':'application/json'};
  const s=raw['X-BOS-Session']||raw['x-bos-session'];if(s)h['X-BOS-Session']=s;
  if(window.BOS_ENSURE_VK_LAUNCH_PARAMS){try{const lp=await window.BOS_ENSURE_VK_LAUNCH_PARAMS();if(lp)h['X-VK-Launch-Params']=lp}catch(_){}}
  return h;
}
window.openMasterProfileEdit=function(){
  if(!masterEditLive())return;
  const u=masterEditUser(),district=masterEditCurrentDistrict();
  openModal(`<h2>Редактировать профиль</h2><form id="masterProfileEditForm" class="form">
    <label>Номер телефона</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(u?.phone||'')}" placeholder="+7 999 123-45-67" required>
    <label>Район города</label><input name="district" list="districtHints" value="${esc(district)}" placeholder="Например: Центральный" maxlength="120"><datalist id="districtHints"><option value="Центральный"><option value="Северный"><option value="Южный"><option value="Западный"><option value="Восточный"><option value="Северо-Западный"><option value="Северо-Восточный"><option value="Юго-Западный"><option value="Юго-Восточный"></datalist>
    <p class="muted">Можно выбрать вариант из списка или вписать свой район.</p>
    <button class="primary wide" type="submit">Сохранить</button><p id="masterProfileEditMsg" class="muted"></p>
  </form>`);
  const form=$('#masterProfileEditForm');
  form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const msg=$('#masterProfileEditMsg'),data=Object.fromEntries(new FormData(form));data.phone=String(data.phone||'').trim();data.district=String(data.district||'').trim();if(typeof isMasterPreview==='function'&&isMasterPreview()&&typeof previewUser!=='undefined'&&previewUser)data.acting_master_vk_id=previewUser.vk_user_id||previewUser.external_id||'';msg.textContent='Сохраняем…';state.busy=true;setBusy(form,true);try{const r=await fetch(PROFILE_API,{method:'POST',headers:await profileHeaders(),body:JSON.stringify(data)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Не удалось сохранить профиль');patchMasterState(d.user);state.busy=false;closeModal();show('team')}catch(err){msg.textContent=err.message||String(err);setBusy(form,false);state.busy=false}}
};
const oldTeam=pages.team;
pages.team=function(){const html=oldTeam();if(!masterEditLive())return html;const marker='<section class="card"><div class="row"><div><h3 style="margin:0">График работы</h3>';
  const edit='<button class="secondary wide masterProfileEditBtn" onclick="openMasterProfileEdit()">Редактировать профиль</button>';
  return String(html).includes(marker)?String(html).replace(marker,edit+marker):String(html)+edit;
};
const style=document.createElement('style');style.textContent='.masterProfileEditBtn{margin:10px 0 12px}';document.head.appendChild(style);
})();