(()=>{
'use strict';
function ownerToolsMode(){return String(state.user?.role||'owner')==='owner'&&!(typeof isMasterPreview==='function'&&isMasterPreview())&&!(typeof isDispatcherPreview==='function'&&isDispatcherPreview())}
function ensureOwnerToolsButton(){
  const header=document.querySelector('header'),profile=document.querySelector('#profileBtn');if(!header||!profile)return;
  let btn=document.querySelector('#ownerToolsBtn');
  if(!btn){btn=document.createElement('button');btn.id='ownerToolsBtn';btn.className='ownerToolsBtn';btn.type='button';btn.setAttribute('aria-label','Инструменты владельца');btn.textContent='⚙';btn.onclick=openOwnerTools;header.insertBefore(btn,profile)}
  btn.style.display=ownerToolsMode()&&state.page==='home'?'grid':'none';
}
function personId(u){return String(u?.vk_user_id||u?.external_id||u?.id||'')}
function previewButton(u){const id=esc(personId(u)),name=esc(u.full_name||'Сотрудник');if(u.role==='master'&&typeof enterMasterPreview==='function')return `<button class="secondary wide ownerPreviewBtn" onclick="enterMasterPreview('${id}')"><span><b>${name}</b><small>Мастер</small></span><b>Открыть ›</b></button>`;if(u.role==='dispatcher'&&typeof enterDispatcherPreview==='function')return `<button class="secondary wide ownerPreviewBtn" onclick="enterDispatcherPreview('${id}')"><span><b>${name}</b><small>Диспетчер</small></span><b>Открыть ›</b></button>`;return ''}
window.openOwnerTools=function(){
  if(!ownerToolsMode())return;
  const people=(state.users||[]).filter(u=>u.role==='master'||u.role==='dispatcher');
  openModal(`<div class="ownerToolsHead"><div><div class="eyebrow">ИНСТРУМЕНТЫ</div><h2 style="margin:3px 0 0">Настройки и тестирование</h2></div></div><section class="card"><h3 style="margin-top:0">Тестирование от лица сотрудника</h3><p class="muted">Откройте приложение так, как его видит выбранный сотрудник.</p>${people.map(previewButton).filter(Boolean).join('')||'<p class="muted">Нет мастеров или диспетчеров для тестирования.</p>'}</section><section class="card"><h3 style="margin-top:0">Инструменты</h3><button class="secondary wide ownerToolAction" onclick="closeModal();show('team')"><span>Команда</span><b>›</b></button><button class="secondary wide ownerToolAction" onclick="closeModal();reloadData(true)"><span>Обновить данные</span><b>↻</b></button></section>`)
};
const baseOpenOwnerProfile=window.openOwnerProfile;
window.openOwnerProfile=function(){
  if((typeof isMasterPreview==='function'&&isMasterPreview())||(typeof isDispatcherPreview==='function'&&isDispatcherPreview()))return baseOpenOwnerProfile();
  if(String(state.user?.role||'')!=='owner')return baseOpenOwnerProfile();
  const u=state.user||{},done=(state.orders||[]).filter(o=>String(o.status)==='Выполнена'),extras=done.reduce((s,o)=>s+Number(o.extra_work_amount||0),0),unfinished=done.reduce((s,o)=>s+Number(o.uncompleted_work_amount||0),0);
  openModal(`<h2>Профиль владельца</h2><section class="card"><div class="ownerProfileLine"><span>Имя</span><b>${esc(u.full_name||'—')}</b></div><div class="ownerProfileLine"><span>Роль</span><b>Владелец</b></div><div class="ownerProfileLine"><span>Город</span><b>${esc(u.city||'—')}</b></div>${u.phone?`<div class="ownerProfileLine"><span>Телефон</span><b>${esc(u.phone)}</b></div>`:''}</section><section class="card"><h3 style="margin-top:0">Корректировки по выполненным заявкам</h3><div class="grid"><div class="metric"><span class="muted">Допработы</span><strong>${money(extras)}</strong></div><div class="metric"><span class="muted">Невыполненные</span><strong>− ${money(unfinished)}</strong></div></div></section><button class="secondary wide" onclick="closeModal();reloadData(true)">Обновить данные</button>`)
};
const baseShowOwnerTools=window.show;
window.show=function(name){baseShowOwnerTools(name);setTimeout(ensureOwnerToolsButton,0)};
const style=document.createElement('style');style.textContent=`header{position:relative}.ownerToolsBtn{width:42px;height:42px;display:none;place-items:center;margin-left:auto;margin-right:8px;border:1px solid rgba(255,255,255,.12);border-radius:13px;background:rgba(255,255,255,.06);color:inherit;font-size:20px;line-height:1;cursor:pointer}.ownerToolsBtn:active{transform:scale(.97)}.ownerPreviewBtn,.ownerToolAction{display:flex!important;align-items:center;justify-content:space-between;text-align:left;margin:8px 0}.ownerPreviewBtn span{display:flex;flex-direction:column;gap:3px}.ownerPreviewBtn small{color:var(--muted,#9badc0);font-weight:500}.ownerProfileLine{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}.ownerProfileLine:first-child{border-top:0}.ownerProfileLine span{color:var(--muted,#9badc0)}@media(max-width:520px){.ownerToolsBtn{width:40px;height:40px;margin-right:6px}}`;document.head.appendChild(style);
setTimeout(ensureOwnerToolsButton,0);
})();