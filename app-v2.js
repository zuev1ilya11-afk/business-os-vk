(()=>{
'use strict';
const API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api';
const PIN_API='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/test-pin-session';
const SESSION_KEY='bos_v2_session';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const roleName=r=>({owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'}[r]||r||'Сотрудник');
const state={user:null,orders:[],users:[],masters:[]};
function getSession(){try{return localStorage.getItem(SESSION_KEY)||''}catch(_){return ''}}
function setSession(v){try{localStorage.setItem(SESSION_KEY,v)}catch(_){}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY)}catch(_){}}
function shell(on){const h=$('header'),n=$('nav');if(h)h.style.display=on?'flex':'none';if(n)n.style.display=on?'flex':'none'}
function content(html){const c=$('#content');if(c)c.innerHTML=html}
async function request(action,payload={}){const s=getSession();if(!s)throw new Error('Требуется вход');const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':s},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));if(r.status===401){clearSession();throw new Error('Сессия истекла')};if(!r.ok||d.ok===false)throw new Error(d.error||('Ошибка сервера '+r.status));return d}
function showLogin(message=''){
 shell(false);
 content(`<section class="hero" style="margin-top:48px"><div class="eyebrow">BUSINESS OS v2</div><h2>Вход</h2><p class="muted">Тестовый режим. VK и Google Drive пока отключены.</p><form id="pinForm" class="form" style="margin-top:18px"><input name="pin" inputmode="numeric" maxlength="6" placeholder="PIN" required><button class="primary wide" type="submit">Войти</button><p id="pinMsg" class="muted">${esc(message)}</p></form></section>`);
 const form=$('#pinForm');
 if(!form)return;
 form.onsubmit=async e=>{e.preventDefault();const msg=$('#pinMsg');msg.textContent='Входим…';try{const r=await fetch(PIN_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:form.elements.pin.value})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Ошибка входа');setSession(d.session_token);await loadApp()}catch(err){msg.textContent=err?.message||'Ошибка входа'}};
}
async function loadApp(){
 shell(false);
 content('<section class="hero" style="margin-top:48px"><h2>Загружаем…</h2><p class="muted">Подключаем рабочие данные</p></section>');
 try{const d=await request('bootstrap');state.user=d.user||{};state.orders=d.orders||[];state.users=d.users||[];state.masters=d.masters||[];showHome()}catch(e){clearSession();showLogin(e?.message||'Не удалось загрузить данные')}
}
function showHome(){
 shell(true);
 const badge=$('#roleBadge');if(badge)badge.textContent=roleName(state.user?.role);
 const avatar=$('#profileBtn');if(avatar)avatar.textContent=(state.user?.full_name||'П').trim().slice(0,1).toUpperCase();
 content(`<div class="eyebrow">РАБОЧАЯ ПАНЕЛЬ</div><h2>${esc(state.user?.full_name||'Домашний мастер')}</h2><div class="grid"><section class="card metric"><span class="muted">Заявок</span><strong>${state.orders.length}</strong></section><section class="card metric"><span class="muted">Мастеров</span><strong>${state.masters.length}</strong></section><section class="card metric"><span class="muted">Сотрудников</span><strong>${state.users.length}</strong></section></div><section class="card"><h3>Ядро v2 запущено</h3><p class="muted">Сейчас проверяем только стабильный вход и загрузку Supabase. Остальной функционал добавим поэтапно.</p></section>`);
 document.querySelectorAll('nav button').forEach(b=>{b.onclick=()=>showPage(b.dataset.page)});
 if(avatar)avatar.onclick=showProfile;
}
function showPage(page){
 document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 if(page==='home')return showHome();
 if(page==='orders')return content(`<h2>Заявки</h2>${state.orders.map(o=>`<section class="card"><b>${esc(o.work||'Заявка')}</b><p class="muted">${esc(o.client||'')} · ${esc(o.status||'')}</p></section>`).join('')||'<p class="muted">Заявок пока нет.</p>'}`);
 if(page==='team')return content(`<h2>Команда</h2>${state.users.map(u=>`<section class="card"><b>${esc(u.full_name||'')}</b><p class="muted">${esc(roleName(u.role))} · ${esc(u.phone||'')}</p></section>`).join('')||'<p class="muted">Сотрудников пока нет.</p>'}`);
 if(page==='dispatch')return content('<h2>График</h2><section class="card"><p class="muted">График добавим следующим этапом после проверки ядра.</p></section>');
}
function showProfile(){content(`<h2>Профиль</h2><section class="card"><h3>${esc(state.user?.full_name||'')}</h3><p class="muted">${esc(roleName(state.user?.role))}</p><button id="logoutBtn" class="wide">Выйти</button></section>`);const b=$('#logoutBtn');if(b)b.onclick=()=>{clearSession();state.user=null;showLogin()}}
function start(){
 try{if(getSession())loadApp();else showLogin()}catch(e){shell(false);content(`<section class="hero"><h2>Ошибка запуска</h2><p class="muted">${esc(e?.message||String(e))}</p><button id="resetBtn" class="primary">Сбросить</button></section>`);const b=$('#resetBtn');if(b)b.onclick=()=>{clearSession();showLogin()}}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();