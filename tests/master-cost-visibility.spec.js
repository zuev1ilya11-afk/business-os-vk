const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge,attachmentUrl}=require('./helpers/edge.cjs');
const money=s=>Number(s.replace(/\s|₽/g,'').replace(',','.'));
async function setup(page,src,role='master',extra={}){
 const data=await fullStack(page,role);
 Object.assign(data.db.tables.orders[0],{source:'Авито',external_source:'avito',original_amount:1000,amount:800,uncompleted_work_amount:200,extra_work_amount:300,master_payout:480,manager_payout:0,dispatcher_payout:0,...src,...extra});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>typeof window.BOS_REFRESH_NOW==='function');
 return data;
}
async function rows(page,values){const details=page.locator('.bosCompactCost');if(await details.count()&&!await details.evaluate(e=>e.open))await details.locator('summary').first().click();for(const [key,value] of Object.entries(values))await expect.poll(async()=>money(await page.locator(`[data-cost-row="${key}"] dd`).innerText())).toBe(value);}
for(const [source,width] of [['Авито',320],['Телефон',390],['VK',1280]])test(`master sees full cost and unchanged breakdown for ${source} at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000});const {db}=await setup(page,{source,external_source:'mini_app'});const before=JSON.stringify(db.tables.orders);
 await page.evaluate(()=>show('orders'));
 const card=page.locator('[data-master-order-id="11"]');
 // Use the current v125 list, not a parallel detail screen.
 await expect(page.locator('[data-master-order-cost]')).toHaveCount(1);
 await expect.poll(async()=>money(await page.locator('[data-master-order-cost] b').innerText())).toBe(1100);
 await page.evaluate(()=>openOrder('11'));
 await expect(page.locator('[data-master-cost]')).toHaveCount(1);
 await page.locator('.bosCompactCost>summary').click();
 await expect(page.locator('[data-master-cost]')).toBeVisible();
 await rows(page,{original:1000,deduction:-200,base:800,extras:300,total:1100,'master-base':480,'master-extras':300,company:320,'master-total':780});
 await expect(page.locator('[data-master-cost]')).toContainText('60%');await expect(page.locator('[data-master-cost]')).toContainText('40%');
 await expect(page.locator('.bosHandsHead')).toContainText('780');
 await page.locator('[data-master-cost]').screenshot({path:testInfo.outputPath(`master-cost-${width}.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await page.locator('[data-master-cost]').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 expect(JSON.stringify(db.tables.orders)).toBe(before);
});
for(const src of [{source:'Hands',external_source:'hands'},{source:'Руки',external_source:'mini_app'},{source:'Авито',external_source:'hands'},{source:'Телефон',external_source:'mini_app',external_id:'hands:90210'}])test('Hands total stays absent in master API, list and detail: '+JSON.stringify(src),async({page})=>{
 await setup(page,src,'master',{master_payout:442});
 expect(await page.evaluate(()=>state.orders[0].amount)).toBeUndefined();
 await page.evaluate(()=>show('orders'));await expect(page.locator('[data-master-order-cost]')).toHaveCount(0);
 await page.evaluate(()=>openOrder('11'));await expect(page.locator('.bosHandsOrder')).toBeVisible();await expect(page.locator('[data-master-cost]')).toHaveCount(0);
 await expect(page.locator('.bosHandsOrder')).not.toContainText('Полная стоимость');await expect(page.locator('.bosHandsOrder')).not.toContainText('Компании');
 await expect(page.locator('.bosHandsHead')).toContainText('442');
});
test('master report, retry, reopen and reload show one current breakdown without duplicate extras',async({page})=>{
 const {db,me}=await setup(page,{},'master',{master_workflow_stage:'started',amount:1000,original_amount:1000,extra_work_amount:0,uncompleted_work_amount:0,master_payout:600});
 const request=edge('order-lifecycle-api',db),body={action:'finalizeMasterReport',order_id:'11',upload_token:'visible-cost',act_url:attachmentUrl('11','visible-cost'),photo_urls:[attachmentUrl('11','visible-cost','photo.jpg')],uncompleted_work_amount:200,extra_work_amount:300};
 const sent=await request(body,me.external_id);expect(sent.status).toBe(200);expect(sent.body.order.amount).toBe(800);
 for(let i=0;i<2;i++){await page.evaluate(()=>window.BOS_REFRESH_NOW());await page.evaluate(()=>openOrder('11'));await expect(page.locator('[data-master-cost]')).toHaveCount(1);await rows(page,{total:1100,'master-total':780,company:320});await page.evaluate(()=>closeModal());}
 const repeated=await request(body,me.external_id);expect(repeated.body.order.amount).toBe(800);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openOrder('11'));await rows(page,{total:1100,'master-total':780});
});
test('saved manual payout is explained without an incorrect percentage or historical rewrite',async({page})=>{
 const {db}=await setup(page,{},'master',{status:'Выполнена',report_review_status:'approved',master_payout:123});const before=JSON.stringify(db.tables.orders);
 await page.evaluate(()=>openOrder('11'));await rows(page,{'master-base':123,'master-total':423,company:677,total:1100});
 const block=page.locator('[data-master-cost]');await expect(block).toContainText('сохранённому отчёту');await expect(block).not.toContainText('60%');await expect(block).not.toContainText('40%');expect(JSON.stringify(db.tables.orders)).toBe(before);
});
test('owner master-preview hides Hands totals even when owner has raw amounts',async({page})=>{
 await setup(page,{source:'Hands',external_source:'hands'},'owner');
 await page.evaluate(()=>{window.isMasterPreview=()=>true;openOrder('11')});
 await expect(page.locator('.bosHandsOrder')).toBeVisible();await expect(page.locator('[data-master-cost]')).toHaveCount(0);
});
