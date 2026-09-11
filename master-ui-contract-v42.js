(()=>{
  'use strict';
  function masterNow(){
    return String(state.user?.role||'')==='master'||(typeof isMasterPreview==='function'&&isMasterPreview());
  }
  function masterOrders(){
    if(typeof ownOrders==='function'){
      try{return ownOrders()||[]}catch(_){ }
    }
    const ids=new Set([state.user?.id,state.user?.vk_user_id,state.user?.user_id,state.user?.external_id].filter(Boolean).map(String));
    return (state.orders||[]).filter(o=>[o.master_id,o.master_vk_id,o.master_user_id,o.master_external_id].filter(Boolean).map(String).some(id=>ids.has(id)));
  }
  function totalSalary(){
    return masterOrders().filter(o=>String(o.status||'')==='Выполнена').reduce((sum,o)=>sum+Number(o.master_payout||0)+Number(o.extra_work_amount||0),0);
  }
  const previousHome=pages.home;
  pages.home=function(){
    const html=previousHome();
    if(!masterNow())return html;
    const hasCabinet=String(html).includes('КАБИНЕТ МАСТЕРА');
    const hasTotal=String(html).includes('Общая зарплата');
    const head=hasCabinet?'':'<div class="eyebrow" style="margin:2px 0 10px">КАБИНЕТ МАСТЕРА</div>';
    const salary=hasTotal?'':`<section class="card masterSalarySummary"><div class="row"><span class="muted">Общая зарплата</span><strong>${money(totalSalary())}</strong></div></section>`;
    return `<div class="masterContractV42">${head}${html}${salary}</div>`;
  };
})();