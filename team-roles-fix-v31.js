(()=>{
'use strict';
const managerMode=()=>String(state.user?.role||'')==='manager'||!!window.BOS_IS_MANAGER_PREVIEW?.();
const ownerMode=()=>String(state.user?.role||'')==='owner'&&!window.BOS_IS_MANAGER_PREVIEW?.()&&!(typeof isDispatcherPreview==='function'&&isDispatcherPreview())&&!(typeof isMasterPreview==='function'&&isMasterPreview());
const roleName=r=>({owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'}[r]||r||'Сотрудник');
function teamCard(u){
  const id=String(u.vk_user_id||u.external_id||u.id||'');
  let stats='';
  if(u.role==='master'){
    const os=(state.orders||[]).filter(o=>String(o.master_vk_id||o.master_id||o.master_staff_id||'')===id||String(o.master_name||'')===String(u.full_name||''));
    const done=os.filter(o=>String(o.status)==='Выполнена');
    const pay=done.reduce((s,o)=>s+Number(o.master_payout||payout(o.amount)),0);
    stats=`<div class="compactStats"><div><small>Выполнено</small><strong>${done.length}</strong></div><div><small>Выплата</small><strong>${money(pay)}</strong></div></div>`;
  }
  return `<button class="card compactTeamCard" onclick="openEmployeeProfile('${esc(id)}')"><div class="row"><div><b>${esc(u.full_name||u.name||'Сотрудник')}</b><small class="muted">${esc(u.city||'')}${u.phone?' · '+esc(u.phone):''}</small></div><span class="status info">${esc(roleName(u.role))}</span></div>${stats}</button>`;
}
const baseTeam=pages.team;
pages.team=function(){
  if(!ownerMode()&&!managerMode())return baseTeam();
  const people=(state.users||[]).filter(u=>u.role!=='owner'&&String(u.is_active??u.active??true)!=='false');
  const add=ownerMode()?'<button class="primary" onclick="openEmployeeForm()">+ Сотрудник</button>':'';
  return `<div class="row"><div><h2>Команда</h2><div class="muted">${people.length} сотрудников</div></div>${add}</div><div class="compactTeam">${people.map(teamCard).join('')||'<p class="muted">Сотрудников пока нет.</p>'}</div>`;
};

const baseTools=window.openOwnerTools;
window.openOwnerTools=function(){
  baseTools?.();
  setTimeout(()=>{
    if(!ownerMode())return;
    const modal=document.querySelector('#modalRoot .modal');if(!modal)return;
    const testSection=[...modal.querySelectorAll('section.card')].find(s=>s.querySelector('h3')?.textContent.includes('Тестирование от лица сотрудника'));
    if(!testSection||testSection.querySelector('.managerPreviewTool'))return;
    const managers=(state.users||[]).filter(u=>u.role==='manager'&&String(u.is_active??u.active??true)!=='false');
    managers.forEach(u=>{
      const id=String(u.id||u.vk_user_id||u.external_id||'');
      const b=document.createElement('button');b.className='secondary wide ownerPreviewBtn managerPreviewTool';
      b.innerHTML=`<span><b>${esc(u.full_name||'Руководитель')}</b><small>Руководитель</small></span><b>Открыть ›</b>`;
      b.onclick=()=>window.enterManagerPreview?.(id);testSection.appendChild(b);
    });
  },0);
};

const baseShow=window.show;
window.show=function(name){baseShow(name);if(window.BOS_IS_MANAGER_PREVIEW?.()){const b=document.querySelector('#ownerToolsBtn');if(b)b.style.display='none'}};
})();