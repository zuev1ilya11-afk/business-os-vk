const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge}=require('./helpers/edge.cjs');
async function setup(page){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const ctx=await fullStack(page,'master');
 Object.assign(ctx.db.tables.orders[0],{phone:'+79990000002',scheduled_date:null,scheduled_time:null,time_slot:null});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 await page.locator('.bosCompactClient a[aria-label^="Позвонить клиенту"]').first().dispatchEvent('click');
 const form=page.locator('#masterContactResultForm');await expect(form).toBeVisible();
 await expect.poll(()=>ctx.db.tables.orders[0].master_contact_history?.length).toBe(1);
 return {...ctx,form};
}
for(const width of [320,390,1280])test(`${width}: whole contact option is tappable with a compact and visible selected state`,async({page},info)=>{
 await page.setViewportSize({width,height:850});const {form}=await setup(page);
 await expect(form.getByRole('button',{name:'Сохранить итог',exact:true})).toBeDisabled();
 for(const result of ['no_answer','thinking','waiting_delivery','call_later','agreed','other']){
  const input=form.locator(`input[value="${result}"]`),row=input.locator('..');
  await row.locator('b').click();await expect(input).toBeChecked();
  await expect(form.locator('input[type=radio]:checked')).toHaveCount(1);
  await expect(form.getByRole('button',{name:'Сохранить итог',exact:true})).toBeEnabled();
  const box=await input.boundingBox();expect(box.width).toBeGreaterThanOrEqual(18);expect(box.width).toBeLessThanOrEqual(26);expect(box.height).toBeLessThanOrEqual(26);
  const colors=await form.evaluate(el=>{
   const selected=el.querySelector('input:checked').closest('label'),other=[...el.querySelectorAll('.bosContactResultChoice')].find(x=>x!==selected);
   return [getComputedStyle(selected).backgroundColor,getComputedStyle(other).backgroundColor];
  });expect(colors[0]).not.toBe(colors[1]);
  if(result==='call_later')await expect(form.locator('[name=callback_at]')).toBeVisible();else await expect(form.locator('[name=callback_at]')).toBeHidden();
 }
 await form.locator('input[value="agreed"]').check();
 await page.locator('#modalRoot .modal').screenshot({path:info.outputPath('contact-selected.png')});
 expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
test('form cannot change or submit twice while a result is saving; failed save keeps the draft',async({page})=>{
 const {form,db}=await setup(page);let release,writes=0;
 const gate=new Promise(resolve=>release=resolve);
 await page.route('**/master-workflow-api',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();
  if(route.request().postDataJSON().action!=='recordContactResult')return route.fallback();
  writes++;await gate;await route.fulfill({status:503,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({ok:false,error:'Тест: ответ не подтверждён'})});
 });
 await form.locator('input[value="waiting_delivery"]').check();await form.locator('[name=comment]').fill('Доставка завтра');
 await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();
 await expect.poll(()=>writes).toBe(1);
 try{
  await expect(form.locator('input[value="agreed"]')).toBeDisabled();
  await expect(form.locator('[name=comment]')).toBeDisabled();
  await expect(form.getByRole('button',{name:'Заполнить позже',exact:true})).toBeDisabled();
 }finally{release()}
 await expect(form.getByRole('button',{name:'Сохранить итог',exact:true})).toBeEnabled();
 await expect(form.locator('input[value="waiting_delivery"]')).toBeChecked();await expect(form.locator('[name=comment]')).toHaveValue('Доставка завтра');
 expect(writes).toBe(1);expect(db.tables.orders[0].master_contact_status).toBe('pending');
});
test('lost result and date responses are reconciled from exact server receipts without another write',async({page})=>{
 const {form,db,master}=await setup(page),workflow=edge('master-workflow-api',db),writes=[];
 const money=Object.fromEntries(['amount','master_payout','manager_payout','dispatcher_payout','extra_work_amount'].map(k=>[k,db.tables.orders[0][k]]));
 await page.route('**/master-workflow-api',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();
  const body=route.request().postDataJSON();if(!['recordContactResult','setAgreementSchedule'].includes(body.action))return route.fallback();
  writes.push(body.action);const result=await workflow(body,master.external_id);expect(result.status).toBe(200);await route.abort('failed');
 });
 await form.locator('input[value="agreed"]').check();await form.locator('[name=comment]').fill('12:00 согласовано');await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();
 const agreement=page.locator('#masterOrderAgree179Form');await expect(agreement).toBeVisible();
 await agreement.locator('[name=scheduled_date]').fill('2099-09-10');await agreement.locator('[name=scheduled_time]').fill('12:00');await agreement.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(agreement).toHaveCount(0);await expect(page.locator('.bosCompactMasterCard')).toBeVisible();
 expect(writes).toEqual(['recordContactResult','setAgreementSchedule']);expect(db.tables.orders[0].master_contact_history).toHaveLength(1);
 expect(db.tables.orders[0].master_agreed_at).toBeTruthy();expect(db.tables.orders[0].scheduled_time).toBe('12:00');
 expect(Object.fromEntries(Object.keys(money).map(k=>[k,db.tables.orders[0][k]]))).toEqual(money);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));
 expect(await page.evaluate(()=>state.orders.find(o=>String(o.id)==='11').master_agreed_at)).toBe(db.tables.orders[0].master_agreed_at);
});
test('an unsaved result is not mistaken for a saved receipt and can be explicitly retried once',async({page})=>{
 const {form,db}=await setup(page);let writes=0;
 const fail=async route=>{
  if(route.request().method()==='OPTIONS'||route.request().postDataJSON().action!=='recordContactResult')return route.fallback();
  writes++;await route.abort('failed');
 };
 await page.route('**/master-workflow-api',fail);await form.locator('input[value="agreed"]').check();await form.locator('[name=comment]').fill('Сохранить этот комментарий');await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();
 await expect(form.locator('.bosContactResultMsg')).toContainText('Ответ на сохранение не получен');await expect(form.getByRole('button',{name:'Сохранить итог',exact:true})).toBeEnabled();
 expect(writes).toBe(1);expect(db.tables.orders[0].master_contact_status).toBe('pending');await expect(page.locator('#masterOrderAgree179Form')).toHaveCount(0);await expect(form.locator('[name=comment]')).toHaveValue('Сохранить этот комментарий');
 await page.unroute('**/master-workflow-api',fail);await form.getByRole('button',{name:'Сохранить итог',exact:true}).click();await expect(page.locator('#masterOrderAgree179Form')).toBeVisible();expect(db.tables.orders[0].master_contact_history).toHaveLength(1);expect(db.tables.orders[0].master_contact_comment).toBe('Сохранить этот комментарий');
});
