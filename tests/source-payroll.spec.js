const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge,employee,attachmentUrl}=require('./helpers/edge.cjs');

test('Direct source real report handlers feed one approved salary into day, week, month and owner views',async({page})=>{
 const fixed=new Date('2026-01-15T10:00:00Z');
 await page.clock.install({time:fixed});
 const {db,me}=await fullStack(page,'master');
 db.tables.business_staff.push(employee('owner','owner'),employee('d','dispatcher'));
 const order=db.tables.orders.find(o=>o.id==='11');order.scheduled_date='2026-01-15';order.source='Авито';order.external_source='avito';
 const FrozenDate=class extends Date{constructor(...args){super(...(args.length?args:[fixed.getTime()]))}static now(){return fixed.getTime()}};
 const lifecycle=edge('order-lifecycle-api',db,{Date:FrozenDate,fetch:async()=>new Response(JSON.stringify({ok:true,order:{...order,drive_archive_status:'archived',drive_archive_url:'https://drive.test/archive'}}))});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>typeof window.BOS_REFRESH_NOW==='function');
 const summary=page.locator('#masterDaySummaryV128');
 await expect(summary.locator('.masterV128Empty')).toBeVisible();

 const submitted=await lifecycle({action:'finalizeMasterReport',order_id:'11',upload_token:'payroll-contract',act_url:attachmentUrl('11','payroll-contract'),photo_urls:[attachmentUrl('11','payroll-contract','photo.jpg')],uncompleted_work_done:true,uncompleted_work_amount:200,extra_work_done:true,extra_work_amount:300},me.external_id);
 expect(submitted.status).toBe(200);expect(order.master_payout).toBe(480);
 await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await expect(summary.locator('.masterV128Empty')).toBeVisible();

 const approved=await lifecycle({action:'reviewReport',id:'11',expected_report_token:order.report_upload_token,expected_report_uploaded_at:order.report_uploaded_at,decision:'approved'},'staff_d');
 expect(approved.status).toBe(200);
 const owner=await edge('mini-app-api',db)({action:'bootstrap'});
 const ownerOrder=owner.body.orders.find(o=>o.id==='11');
 expect(ownerOrder.master_payout).toBe(480);expect(ownerOrder.extra_work_amount).toBe(300);
 expect(ownerOrder.manager_payout).toBe(0);expect(ownerOrder.dispatcher_payout).toBe(0);

 await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await expect(summary.locator('.masterV128Done')).toHaveCount(1);
 for(const [label,value] of [['По заявкам','480'],['Допработы','300'],['Вычеты (уже учтены)','200'],['Итого','780']]){
  await expect(summary.getByText(label,{exact:true}).locator('..')).toContainText(value);
 }
 await page.locator('nav button[data-page="team"]').click();
 const panel=page.locator('#masterProfileSummaryV129');
 for(const label of ['День','Неделя','Месяц']){await panel.getByRole('button',{name:label,exact:true}).click();await expect(panel.locator('.salaryHero')).toContainText('780')}
 await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await expect(page.locator('.salaryOrder')).toHaveCount(1);
 await expect(page.locator('.salaryOrder')).toContainText('780');
});

for(const width of [320,1280])test(`new-order pricing follows source without changing Hands at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});await fullStack(page,'owner');await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrderForm());
 const form=page.locator('#orderForm');
 await form.locator('[name="original_amount"]').fill('1000');
 await form.locator('[name="master_vk_id"]').selectOption('staff_m');
 await expect(form.locator('#bosMasterPay')).toContainText('600');
 await expect(form.locator('#bosPricingRule')).toContainText('400');
 await form.locator('[name="source"][value="Руки"]').check();
 await expect(form.locator('#bosMasterPay')).toContainText(/552[,.]5/);
 await expect(form.locator('#bosPricingRule')).toContainText('Hands');
 await expect(form.locator('#bosPricingRule')).not.toContainText('40%');
 await form.locator('[name="source"][value="Телефон"]').check();
 await expect(form.locator('#bosMasterPay')).toContainText('600');
 await expect(form.locator('#bosPricingRule')).toContainText('Компания 40%');
 await page.screenshot({path:testInfo.outputPath(`source-payroll-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('owner sees direct company pool and stored historical payout without repricing',async({page})=>{
 const {db}=await fullStack(page,'owner');
 Object.assign(db.tables.orders[0],{source:'Телефон',external_source:'mini_app',amount:1000,status:'Выполнена',report_review_status:'approved',master_payout:123,manager_payout:45,dispatcher_payout:67});
 const before=JSON.stringify(db.tables.orders);await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.evaluate(()=>openOrder('11'));
 await expect(page.locator('#payoutPreview')).toContainText('123');
 await expect(page.locator('[data-payroll-company]')).toContainText('Сохранённый расчёт');
 await expect(page.locator('[data-payroll-company]')).toContainText('877');
 expect(JSON.stringify(db.tables.orders)).toBe(before);
});
