const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge}=require('./helpers/edge.cjs');
const stamp='2026-10-04T10:00:00.000Z',doneAt='2026-10-04T10:10:00.000Z';
const event={actor_id:'owner',actor_name:'Иван <Иванов>',actor_role:'owner',at:doneAt,reason:'Мастер не может отправить отчёт'};
async function fixture(page,role){
 const x=await fullStack(page,role);x.db.tables.orders.forEach(o=>o.updated_at=stamp);const order=x.db.tables.orders[0];
 let writes=0;const baseRpc=x.db.rpc;x.db.rpc=async(name,p)=>{
  if(name!=='bos_manual_complete_order')return baseRpc(name,p);
  // UI transport fixture; real transaction invariants are exercised by the PostgreSQL suite.
  if(order.status!=='Выполнена'){writes++;Object.assign(order,{status:'Выполнена',completed_at:doneAt,updated_at:doneAt,manual_completion_history:[{...event,actor_role:role,reason:p.p_reason}]})}
  return {data:{ok:true,order:{...order},idempotent:writes>1},error:null};
 };
 return {...x,order,writes:()=>writes};
}
for(const role of ['owner','manager'])test(`${role}: manual completion requires reason, confirms once and preserves stored finance`,async({page})=>{
 const x=await fixture(page,role);await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrder('11'));await page.getByRole('button',{name:'Завершить вручную',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Завершить заявку вручную?'})).toBeVisible();
 const form=page.locator('#manualCompletionForm');await form.getByRole('button',{name:'Завершить заявку',exact:true}).click();expect(x.writes()).toBe(0);
 await form.getByLabel('Причина ручного завершения').fill('   ');await form.getByRole('button',{name:'Завершить заявку',exact:true}).click();expect(x.writes()).toBe(0);
 await form.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.locator('.bosManageOrder')).toBeVisible();expect(x.writes()).toBe(0);
 await page.getByRole('button',{name:'Завершить вручную',exact:true}).click();await form.getByLabel('Причина ручного завершения').fill(event.reason);
 await form.getByRole('button',{name:'Завершить заявку',exact:true}).click();await expect(page.locator('.bosManualCompletionHistory')).toContainText('Завершено вручную');
 await expect(page.getByRole('button',{name:'Завершить вручную',exact:true})).toHaveCount(0);expect(x.writes()).toBe(1);expect(x.order.master_payout).toBe(552.5);expect(x.order.report_uploaded_at).toBeUndefined();
 await page.locator('.bosManualCompletionHistory summary').click();await expect(page.locator('.bosManualCompletionHistory')).toContainText(event.reason);await expect(page.locator('.bosManualCompletionHistory')).toContainText('Иван <Иванов>');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
for(const role of ['master','dispatcher'])test(`${role}: no manual action; existing completion audit remains read-only`,async({page})=>{
 const x=await fixture(page,role);
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 await expect(page.getByRole('button',{name:'Завершить вручную',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.openManualCompletion?.('11'));await expect(page.locator('#manualCompletionForm')).toHaveCount(0);
 Object.assign(x.order,{status:'Выполнена',completed_at:doneAt,manual_completion_history:[event],report_review_status:'not_submitted'});
 await page.evaluate(async()=>{await reloadData(true);openOrder('11')});
 await expect(page.getByRole('button',{name:'Завершить вручную',exact:true})).toHaveCount(0);
 await expect(page.locator('.bosManualCompletionHistory')).toContainText('Завершено вручную');
 await expect(page.locator('#modalRoot')).not.toContainText('Отчёт принят');
 await page.evaluate(()=>window.openManualCompletion?.('11'));await expect(page.locator('#manualCompletionForm')).toHaveCount(0);expect(x.writes()).toBe(0);
});
test('closed and cancelled orders cannot open manual completion',async({page})=>{
 const x=await fixture(page,'owner');x.order.status='Отменена';x.db.tables.orders[1].status='Выполнена';
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 for(const id of ['11','12']){await page.evaluate(id=>openOrder(id),id);await expect(page.getByRole('button',{name:'Завершить вручную',exact:true})).toHaveCount(0)}
});
test('lost response reconciles the committed order without sending completion twice',async({page})=>{
 const x=await fixture(page,'owner');const handler=edge('order-lifecycle-api',x.db);let attempts=0;
 await page.route(/\/(?:functions\/v1|api\/proxy)\/order-lifecycle-api(?:\?|$)/,async r=>{
  if(r.request().method()==='OPTIONS')return r.fallback();
  attempts++;await handler(r.request().postDataJSON(),x.me.external_id);await r.abort('failed');
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 await page.getByRole('button',{name:'Завершить вручную',exact:true}).click();await page.getByLabel('Причина ручного завершения').fill(event.reason);await page.getByRole('button',{name:'Завершить заявку',exact:true}).click();
 await expect(page.locator('.bosManualCompletionHistory')).toContainText('Завершено вручную');expect(attempts).toBe(1);expect(x.writes()).toBe(1);
});
test('offline uncertainty blocks resubmission until a successful state check',async({page})=>{
 const x=await fixture(page,'owner');let offline=false,attempts=0;
 await page.route(/\/(?:functions\/v1|api\/proxy)\/(?:order-lifecycle-api|mini-app-api)(?:\?|$)/,async r=>{
  if(r.request().method()==='OPTIONS')return r.fallback();
  const body=r.request().postDataJSON();
  if(body?.action==='manualCompleteOrder'){attempts++;if(attempts===1)offline=true}
  if(offline)return r.abort('failed');
  return r.fallback();
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 await page.getByRole('button',{name:'Завершить вручную',exact:true}).click();await page.getByLabel('Причина ручного завершения').fill(event.reason);
 const submit=page.getByRole('button',{name:'Завершить заявку',exact:true});await submit.click();
 // The existing bootstrap transport has a bounded 15s failover budget.
 await expect(page.locator('#manualCompletionForm [role=status]')).toContainText('Результат сохранения неизвестен',{timeout:22000});await expect(submit).toBeDisabled();expect(attempts).toBe(1);expect(x.writes()).toBe(0);
 offline=false;await page.getByRole('button',{name:'Проверить состояние',exact:true}).click();await expect(submit).toBeEnabled();await expect(page.getByLabel('Причина ручного завершения')).toHaveValue(event.reason);
 await submit.click();await expect(page.locator('.bosManualCompletionHistory')).toContainText('Завершено вручную');expect(attempts).toBe(2);expect(x.writes()).toBe(1);
});
for(const role of ['owner','master'])test(`${role}: manually closed Hands card displays saved zero and custom payout`,async({page})=>{
 const x=await fixture(page,role);Object.assign(x.order,{status:'Выполнена',completed_at:doneAt,master_payout:0,manual_completion_history:[event]});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 const amount=page.locator(role==='master'?'.bosCompactMoney span':'.bosManageMoney span');
 await expect(amount).toHaveText(/(?:Выплата|Мастеру):\s*0\s*₽/);
 x.order.master_payout=123;await page.evaluate(async()=>{await reloadData(true);openOrder('11')});await expect(amount).toHaveText(/(?:Выплата|Мастеру):\s*123\s*₽/);
});
