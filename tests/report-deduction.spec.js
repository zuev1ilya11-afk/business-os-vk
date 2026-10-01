const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const D=require('../report-deduction.js');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
async function start(page,source='Телефон',width=390){
 const data=await fullStack(page,'master');
 Object.assign(data.db.tables.orders[0],{source,original_amount:10000,amount:9500,uncompleted_work_amount:500,master_workflow_stage:'started'});
 data.db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:'https://test.invalid/storage/v1/object/sign/business-os-vk-files/'+path+'?token=test'},error:null})})};
 await page.setViewportSize({width,height:900});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106===true);
 await page.evaluate(()=>openMasterReportForm('11'));return data;
}
async function incomplete(page){await page.locator('label').filter({has:page.locator('[name=mrAllDone][value=false]')}).click();await expect(page.locator('#mrDeductionDialog')).toBeVisible();}
async function add(page,id,query){await page.locator('#mrAddCatalog').click();await page.locator('#mrCatalogSearch').fill(query);await page.locator(`[data-service="${id}"]`).click();}
async function files(page){await page.locator('#mrAct').setInputFiles({name:'act.txt',mimeType:'text/plain',buffer:Buffer.from('act')});await page.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});}
for(const width of [320,390,768,1280])test(`catalog, fractional qty, remove, restore and layout at ${width}px`,async({page})=>{
 await start(page,'Телефон',width);await files(page);
 await expect(page.locator('#mrUnfinishedBox')).toBeHidden();await incomplete(page);
 await page.locator('#mrAddCatalog').click();await page.locator('#mrCatalogSearch').fill('xyz-no-work');await expect(page.locator('#mrCatalogResults')).toContainText('Работы не найдены');await page.locator('#mrCatalogSearch').fill('бленды');await page.locator('[data-service=standard_016]').click();
 await page.locator('[data-qty="0"]').fill('1,5');await expect(page.locator('#mrDeductionTotal')).toContainText('450');await expect(page.locator('#mrAfterDeduction')).toContainText('9 550');
 await add(page,'standard_015','подхвата');await page.locator('[data-qty="1"]').fill('2');await expect(page.locator('#mrDeductionTotal')).toContainText('810');await page.locator('[data-remove="1"]').click();await expect(page.locator('.deductionItem')).toHaveCount(1);
 await page.locator('#mrDeductionComment').fill('Не подошёл размер');
 await expect(page.locator('#mrDeductionContinue')).toBeVisible();
 expect(await page.locator('#mrDeductionDialog').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:`test-results/deduction-${width}.png`,fullPage:true});
 await page.locator('#mrDeductionContinue').click();await page.locator('label').filter({has:page.locator('[name=mrAllDone][value=true]')}).click();await expect(page.locator('#mrUnfinishedBox')).toBeHidden();
 expect(await page.locator('#masterReportForm').evaluate(f=>f.bosDeductionPayload())).toEqual({uncompleted_work_done:false,uncompleted_work_items:[],uncompleted_work_amount:0,uncompleted_work_description:''});
 await incomplete(page);await expect(page.locator('[data-qty="0"]')).toHaveValue('1.5');await expect(page.locator('#mrDeductionComment')).toHaveValue('Не подошёл размер');await page.locator('#mrDeductionContinue').click();
 expect(await page.locator('#mrAct').evaluate(e=>e.files.length)).toBe(1);expect(await page.locator('#mrPhotos').evaluate(e=>e.files.length)).toBe(1);
});
for(const source of ['Hands','Авито','Телефон'])test(`${source}: complete report persists deduction, preserves extras and hides Hands cost`,async({page})=>{
 const {db}=await start(page,source);await files(page);await incomplete(page);await add(page,'standard_016','бленды');await page.locator('[data-qty="0"]').fill('1.5');
 if(source==='Hands'){await expect(page.locator('#mrAfterDeduction')).toHaveCount(0);await expect(page.locator('#mrDeductionDialog')).not.toContainText('9 550');}
 else await expect(page.locator('#mrAfterDeduction')).toContainText('9 550');
 await page.locator('#mrDeductionComment').fill('Не подошёл размер');await page.locator('#mrDeductionContinue').click();await page.locator('label').filter({has:page.locator('[name=mrExtra][value=true]')}).click();await page.locator('#mrExtraDesc').fill('Отдельная допработа');await page.locator('#mrExtraAmount').fill('200');
 await page.getByRole('button',{name:'Отправить отчёт и завершить'}).click();await expect(page.locator('#masterReportForm')).toHaveCount(0);
 const o=db.tables.orders[0];expect(o.amount).toBe(9550);expect(o.original_amount).toBe(10000);expect(o.uncompleted_work_amount).toBe(450);expect(o.uncompleted_work_items[0].quantity).toBe(1.5);expect(o.extra_work_amount).toBe(200);expect(o.master_payout).toBe(source==='Hands'?5276.38:5730);expect(o.report_review_status).toBe('pending');
});
test('everything done sends zero and no details after selection',async({page})=>{
 const {db}=await start(page);await files(page);await incomplete(page);await add(page,'standard_016','бленды');await page.locator('#mrDeductionContinue').click();await page.locator('label').filter({has:page.locator('[name=mrAllDone][value=true]')}).click();await page.getByRole('button',{name:'Отправить отчёт и завершить'}).click();await expect(page.locator('#masterReportForm')).toHaveCount(0);const o=db.tables.orders[0];expect(o.amount).toBe(10000);expect(o.uncompleted_work_items).toEqual([]);expect(o.uncompleted_work_amount).toBe(0);expect(o.uncompleted_work_description).toBe('');
});
test('from-price is empty until entered and confirmed; invalid quantity/overrun blocked',async({page})=>{
 await start(page,'Авито');await incomplete(page);await add(page,'avito_socket_install','Установка розеток');await expect(page.locator('[data-price="0"]')).toHaveValue('');await page.locator('#mrDeductionContinue').click();await expect(page.locator('#mrDeductionError')).toContainText('Цена');
 await page.locator('[data-price="0"]').fill('350');await page.locator('#mrDeductionContinue').click();await expect(page.locator('#mrDeductionError')).toContainText('Подтвердите');await page.locator('[data-confirm="0"]').check();
 await page.locator('[data-qty="0"]').fill('1.5');await page.locator('#mrDeductionContinue').click();await expect(page.locator('#mrDeductionError')).toContainText('Количество');
 await page.locator('[data-qty="0"]').fill('30');await page.locator('#mrDeductionContinue').click();await expect(page.locator('#mrDeductionError')).toContainText('превышает');
 await page.locator('[data-qty="0"]').fill('2');await page.locator('#mrDeductionContinue').click();await expect(page.locator('#mrDeductionDialog')).not.toBeVisible();
});
test('dispatcher sees stored price/quantity breakdown and legacy description',async({page})=>{
 const {db}=await fullStack(page,'dispatcher');Object.assign(db.tables.orders[0],{report_uploaded_at:new Date().toISOString(),report_review_status:'pending',uncompleted_work_amount:375,uncompleted_work_description:'Не подошёл размер',uncompleted_work_items:D.items([{service_id:'standard_016',quantity:1.25,unit_price:300}])});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>openReportReview('11'));await expect(page.locator('.reportUncompletedDetails')).toContainText('1.25 п.м. × 300');await expect(page.locator('.reportUncompletedDetails')).toContainText('375');await expect(page.locator('.reportUncompletedDetails')).toContainText('Не подошёл размер');
 await page.evaluate(()=>{state.orders.find(o=>o.id==='11').uncompleted_work_items=null;openReportReview('11');});await expect(page.locator('.reportUncompletedDetails')).toContainText('Старый отчёт без детализации');
});
