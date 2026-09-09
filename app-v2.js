(()=>{
'use strict';
const API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api';
const PIN_API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/test-pin-session';
const SESSION_KEY='bos_v2_session';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const roleName=r=>({owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'}[r]||r||'Сотрудник');
const state={user:null,orders:[],users:[],masters:[]};
let previewMaster=null;
function getSession(){try{return localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}}
function setSession(v){try{localStorage.setItem(SESSION_KEY,v)}catch(_){}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY)}catch(_){}}
function shell(on){const h=$('header'),n=$('nav');if(h)h.style.display=on?'flex':'none';if(n)n.style.display=on?'grid':'none'}
function content(html){const c=$('#content');if(c)c.innerHTML=html}
function isAdmin(){return ['owner','manager'].includes(String(state.user?.role||''))}
function masterId(u){return String(u?.vk_user_id||u?.external_id||u?.id||'')}
function visibleOrders(){if(!previewMaster)return state.orders;const id=masterId(previewMaster);return state.orders.filter(o=>String(o.master_vk_id||o.master_external_id||o.master_id||'')===id)}
function completedOrders(){return visibleOrders().filter(o=>o.status==='Выполнена')}
function masterPayout(o){const n=Number(o?.master_payout);if(Number.isFinite(n)&&n>0)return n;const amount=Number(o?.amount||o?.original_amount||0);return Math.round(amount*.85*.65*100)/100}
function money(n){return `${Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`}
function updateChrome(){
 const badge=$('#roleBadge'),avatar=$('#profileBtn');
 if(previewMaster){if(badge)badge.textContent='Мастер · просмотр';if(avatar)avatar.textContent=(previewMaster.full_name||'М').trim().slice(0,1).toUpperCase()}
 else{if(badge)badge.textContent=roleName(state.user?.role);if(avatar)avatar.textContent=(state.user?.full_name||'П').trim().slice(0,1).toUpperCase()}
 document.querySelectorAll('nav button').forEach(b=>{const page=b.dataset.page;if(previewMaster){if(page==='orders')b.textContent='Мои заявки';else if(page==='team')b.textContent='Профиль';else if(page==='profile')b.textContent='Админ';else if(page==='home')b.textContent='Главная';else if(page==='dispatch')b.textContent='График'}else{if(page==='home')b.textContent='Главная';if(page==='orders')b.textContent='Заявки';if(page==='dispatch')b.textContent='График';if(page==='team')b.textContent='Команда';if(page==='profile')b.textContent='Профиль'}})
}
async function request(action,payload={}){const s=getSession();if(!s)throw new Error('Требуется вход');const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':s},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));if(r.status===401){clearSession();throw new Error('Сессия истекла')};if(!r.ok||d.ok===false)throw new Error(d.error||('Ошибка сервера '+r.status));return d}
function showLogin(message=''){
 previewMaster=null;shell(false);
 content(`<section class="hero" style="margin-top:48px"><div class="eyebrow">BUSINESS OS v2</div><h2>Вход</h2><form id="pinForm" class="form" style="margin-top:18px"><input name="pin" inputmode="numeric" maxlength="6" placeholder="PIN" required><button class="primary wide" type="submit">Войти</button><p id="pinMsg" class="muted">${esc(message)}</p></form></section>`);
 const form=$('#pinForm');if(!form)return;
 form.onsubmit=async e=>{e.preventDefault();const msg=$('#pinMsg');msg.textContent='Входим…';try{const r=await fetch(PIN_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:form.elements.pin.value})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка входа');setSession(d.session_token);await loadApp()}catch(err){msg.textContent=err?.message||'Ошибка входа'}};
}
async function loadApp(){
 shell(false);content('<section class="hero" style="margin-top:48px"><h2>Загружаем…</h2><p class="muted">Подключаем рабочие данные</p></section>');
 try{const d=await request('bootstrap');state.user=d.user||{};state.orders=d.orders||[];state.users=d.users||[];state.masters=d.masters||[];previewMaster=null;showHome()}catch(e){clearSession();showLogin(e?.message||'Не удалось загрузить данные')}
}
function bindShell(){document.querySelectorAll('nav button').forEach(b=>{b.onclick=()=>showPage(b.dataset.page)});const avatar=$('#profileBtn');if(avatar)avatar.onclick=showProfile;updateChrome()}
function showHome(){
 shell(true);bindShell();
 if(previewMaster){const orders=visibleOrders(),done=completedOrders(),active=orders.filter(o=>o.status==='В работе'),pay=done.reduce((a,o)=>a+masterPayout(o),0);content(`<section class="previewBanner"><span>Режим просмотра мастера</span><button id="previewExitTop" class="linkBtn">Выйти</button></section><div class="eyebrow">КАБИНЕТ МАСТЕРА</div><h2>${esc(previewMaster.full_name||'Мастер')}</h2><div class="grid masterHomeGrid"><section class="card metric"><span class="muted">В работе</span><strong>${active.length}</strong></section><section class="card metric"><span class="muted">Выполнено</span><strong>${done.length}</strong></section><section class="card metric"><span class="muted">Моя выплата</span><strong>${money(pay)}</strong></section><section class="card metric"><span class="muted">Всего заявок</span><strong>${orders.length}</strong></section></div><section class="card"><h3>Ближайшие заявки</h3>${active.slice(0,4).map(o=>`<div class="adminOrderRow"><span>${esc(o.work||'Заявка')}</span><b>${esc(o.scheduled_date||'')}</b></div>`).join('')||'<p class="muted">Активных заявок нет.</p>'}</section>`);$('#previewExitTop').onclick=exitMasterPreview;return}
 content(`<div class="eyebrow">РАБОЧАЯ ПАНЕЛЬ</div><h2>${esc(state.user?.full_name||'Домашний мастер')}</h2><div class="grid"><section class="card metric"><span class="muted">Заявок</span><strong>${state.orders.length}</strong></section><section class="card metric"><span class="muted">Мастеров</span><strong>${state.masters.length}</strong></section><section class="card metric"><span class="muted">Сотрудников</span><strong>${state.users.length}</strong></section></div>`)
}
function showPage(page){
 shell(true);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));updateChrome();
 if(page==='home')return showHome();
 if(page==='profile')return showProfile();
 if(page==='orders'){const orders=visibleOrders();return content(`<h2>${previewMaster?'Мои заявки':'Заявки'}</h2>${orders.map(o=>`<section class="card"><b>${esc(o.work||'Заявка')}</b><p class="muted">${esc(o.client||'')} · ${esc(o.status||'')}</p><p class="muted">${esc(o.scheduled_date||'')} ${esc(o.scheduled_time||'')}</p>${previewMaster&&o.status==='Выполнена'?`<p>Моя выплата: <b>${money(masterPayout(o))}</b></p>`:''}</section>`).join('')||'<p class="muted">Заявок пока нет.</p>'}`)}
 if(page==='team'){if(previewMaster)return showMasterProfile();return content(`<h2>Команда</h2>${state.users.map(u=>`<section class="card"><b>${esc(u.full_name||'')}</b><p class="muted">${esc(roleName(u.role))} · ${esc(u.phone||'')}</p></section>`).join('')||'<p class="muted">Сотрудников пока нет.</p>'}`)}
 if(page==='dispatch'){const orders=visibleOrders().filter(o=>o.scheduled_date).sort((a,b)=>String(a.scheduled_date+a.scheduled_time).localeCompare(String(b.scheduled_date+b.scheduled_time)));return content(`<h2>${previewMaster?'Мой график':'График'}</h2>${orders.map(o=>`<section class="card"><b>${esc(o.scheduled_date||'')} ${esc(o.scheduled_time||'')}</b><p>${esc(o.work||'Заявка')}</p><p class="muted">${esc(o.address||'')} · ${esc(o.status||'')}</p></section>`).join('')||'<section class="card"><p class="muted">Нет запланированных заявок.</p></section>`)}
}
function showMasterProfile(){const u=previewMaster;content(`<section class="previewBanner"><span>Режим просмотра мастера</span><button id="previewExitProfile" class="linkBtn">Выйти</button></section><h2>Профиль мастера</h2><section class="card"><h3>${esc(u?.full_name||'')}</h3><p class="muted">Мастер</p><p><b>Телефон:</b> ${esc(u?.phone||'—')}</p><p><b>Город:</b> ${esc(u?.city||'—')}</p><p><b>Специализация:</b> ${esc(u?.specialization||'—')}</p></section>`);$('#previewExitProfile').onclick=exitMasterPreview}
function enterMasterPreview(id){const u=state.masters.find(m=>masterId(m)===String(id))||state.users.find(m=>m.role==='master'&&masterId(m)===String(id));if(!u)return;previewMaster=u;showHome()}
function exitMasterPreview(){previewMaster=null;showProfile()}
function showProfile(){
 shell(true);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page==='profile'));updateChrome();
 if(previewMaster)return showMasterProfile();
 const admin=isAdmin();
 content(`<h2>Профиль</h2><section class="card"><h3>${esc(state.user?.full_name||'')}</h3><p class="muted">${esc(roleName(state.user?.role))}</p></section>${admin?`<section class="card adminPanel"><div class="eyebrow">ПАНЕЛЬ АДМИНИСТРАТОРА</div><h3>Просмотр кабинетов</h3><p class="muted">Выберите мастера, чтобы увидеть приложение так, как его видит он. Это только режим просмотра — права и данные не меняются.</p><div class="adminMasterList">${state.masters.map(m=>`<button class="secondary wide adminMasterBtn" data-master-id="${esc(masterId(m))}"><span><b>${esc(m.full_name||'Мастер')}</b><small>${esc(m.city||'')} ${m.specialization?'· '+esc(m.specialization):''}</small></span><strong>Открыть →</strong></button>`).join('')||'<p class="muted">Мастеров пока нет.</p>'}</div></section>`:''}<button id="logoutBtn" class="secondary wide">Выйти</button>`);
 document.querySelectorAll('.adminMasterBtn').forEach(b=>b.onclick=()=>enterMasterPreview(b.dataset.masterId));const out=$('#logoutBtn');if(out)out.onclick=()=>{clearSession();state.user=null;previewMaster=null;showLogin()}
}
function start(){try{if(getSession())loadApp();else showLogin()}catch(e){shell(false);content(`<section class="hero"><h2>Ошибка запуска</h2><p class="muted">${esc(e?.message||String(e))}</p><button id="resetBtn" class="primary">Сбросить</button></section>`);const b=$('#resetBtn');if(b)b.onclick=()=>{clearSession();showLogin()}}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();