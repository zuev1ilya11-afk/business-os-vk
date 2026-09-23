const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');
const {fullStack}=require('./helpers/full-stack.cjs');

test('lifecycle service keeps submitted reports pending and archives before approval',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','supabase','functions','order-lifecycle-api','index.ts'),'utf8');
  expect(source).toContain("status:'В работе'");
  expect(source).toContain("report_review_status:'pending'");
  expect(source).toContain('completed_at:null');
  expect(source).toContain('archiveBeforeApproval(req,order)');
  expect(source).toContain("status:decision==='approved'?'Выполнена':'В работе'");
  expect(source).toContain("String(prev.data?.report_review_status||'')==='approved'");
});

test('dispatcher keeps completed Hands order on dashboard and can open reclamation',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106===true);
  await page.evaluate(()=>{
    const o=state.orders.find(x=>String(x.id)==='12');
    Object.assign(o,{status:'Выполнена',external_source:'hands',external_id:'hands:HANDS-90210',completed_at:new Date().toISOString(),report_review_status:'approved'});
    show('home');
  });
  const done=page.locator('.lifecycleDoneCard').filter({hasText:'HANDS-90210'});
  await expect(done).toBeVisible();
  await expect(done).not.toContainText('№ 12');
  await done.getByRole('button',{name:'Открыть рекламацию'}).click();
  await expect(page.getByRole('heading',{name:'Открыть рекламацию'})).toBeVisible();
  await expect(page.locator('#claimForm textarea[name="reason"]')).toBeVisible();
});

test('manual completion is blocked until report approval',async({page})=>{
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_ORDER_LIFECYCLE_V106===true);
  const result=await page.evaluate(async()=>{
    const r=await fetch('/mini-app-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'updateOrder',id:'11',status:'Выполнена'})});
    return {status:r.status,body:await r.json()};
  });
  expect(result.status).toBe(409);
  expect(result.body.error).toContain('только после приёма отчёта');
});
