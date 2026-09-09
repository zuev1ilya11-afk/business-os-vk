(()=>{
  const basePayout=typeof payout==='function'?payout:(a=>Math.round(Number(a||0)*.85*.65*100)/100);
  window.recalcFinal=function(form){
    const base=Number(form.elements.original_amount?.value||0);
    const completed=form.elements.status?.value==='Выполнена';
    const deduction=completed&&form.elements.uncompleted_work_done?.value==='true'?Number(form.elements.uncompleted_work_amount?.value||0):0;
    const final=Math.max(0,base-deduction);
    const extra=completed&&form.elements.extra_work_done?.value==='true'?Number(form.elements.extra_work_amount?.value||0):0;
    const f=form.querySelector('#finalAmount'),p=form.querySelector('#calcPay');
    if(f)f.textContent=money(final);
    if(p){
      p.textContent=money(basePayout(final));
      p.dataset.totalWithExtra=String(basePayout(final)+extra);
    }
  };
  const prev=window.openOrderForm;
  window.openOrderForm=function(id){
    prev(id);
    const form=document.querySelector('#orderForm');
    if(!form)return;
    const run=()=>window.recalcFinal(form);
    ['original_amount','master_vk_id','status','uncompleted_work_done','uncompleted_work_amount','extra_work_done','extra_work_amount'].forEach(name=>{
      const el=form.elements[name];if(!el)return;el.addEventListener('input',run);el.addEventListener('change',run);
    });
    run();
  };
})();