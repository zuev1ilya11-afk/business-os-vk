const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {edge}=require('./helpers/edge.cjs');
test('HTTP 500 after commit checks the receipt before another finalization',async({page})=>{
 const f=await fullStack(page,'master',{productionOrderGuards:true});f.db.tables.orders[0].master_workflow_stage='started';
 f.db.storage={from:()=>({upload:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:`https://test.invalid/storage/v1/object/sign/business-os-vk-files/${path}?token=test-signature`}})})};
 let calls=0;const actual=edge('order-lifecycle-api',f.db);
 await page.route(/\/(?:api\/proxy|functions\/v1)\/order-lifecycle-api(?:\?|$)/,async route=>{
  const body=route.request().postDataJSON();if(body.action!=='finalizeMasterReport')return route.fallback();calls++;
  expect((await actual(body,f.me.external_id)).status).toBe(200);
  await route.fulfill({status:500,json:{ok:false,error:'AFTER_COMMIT_ERROR'}});
 });
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106===true);await page.evaluate(()=>openMasterReportForm('11'));
 await page.locator('#mrAct').setInputFiles({name:'act.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic')});
 await page.locator('#mrPhotos').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64')});
 await page.locator('#masterReportForm button[type=submit]').click();
 await expect(page.locator('#mrMsg')).toContainText('Отчёт уже загружен и ожидает проверки');
 expect(calls).toBe(1);expect(f.db.calls.filter(x=>x.table==='orders'&&x.mode==='update')).toHaveLength(1);
});
