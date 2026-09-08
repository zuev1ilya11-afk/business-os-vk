const managerPayout=a=>Math.round(Number(a||0)*.85*.94*.20*100)/100;
const dispatcherPayout=a=>Math.round(Number(a||0)*.85*.94*.15*100)/100;
const originalHome=pages.home;
pages.home=function(){
  const done=state.orders.filter(o=>o.status==='Выполнена');
  const rev=done.reduce((a,o)=>a+Number(o.amount||0),0);
  const masters=done.reduce((a,o)=>a+Number(o.master_payout||payout(o.amount)),0);
  const managers=done.reduce((a,o)=>a+Number(o.manager_payout||managerPayout(o.amount)),0);
  const dispatchers=done.reduce((a,o)=>a+Number(o.dispatcher_payout||dispatcherPayout(o.amount)),0);
  return `<section class="hero"><div class="eyebrow">ВЛАДЕЛЕЦ · БЕЗ ВХОДА</div><h2>Business OS</h2><p class="muted">Google Sheets синхронизированы с приложением.</p></section><div class="grid"><div class="card metric"><span class="muted">Заявок</span><strong>${state.orders.length}</strong></div><div class="card metric"><span class="muted">Мастеров</span><strong>${state.masters.length}</strong></div><div class="card metric"><span class="muted">В работе</span><strong>${state.orders.filter(o=>['Назначена','В работе'].includes(o.status)).length}</strong></div><div class="card metric"><span class="muted">Выручка</span><strong>${money(rev)}</strong></div><div class="card metric"><span class="muted">Мастерам</span><strong>${money(masters)}</strong></div><div class="card metric"><span class="muted">Руководителю</span><strong>${money(managers)}</strong></div><div class="card metric"><span class="muted">Диспетчеру</span><strong>${money(dispatchers)}</strong></div></div><section class="card"><h3>Формулы</h3><p class="muted">Мастер: сумма − 15%, затем − 35%.</p><p class="muted">Руководитель: сумма − 15%, затем − 6%, затем 20% от остатка.</p><p class="muted">Диспетчер: сумма − 15%, затем − 6%, затем 15% от остатка.</p></section>`;
};