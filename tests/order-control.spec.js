const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {businessDay,nextDay}=require('../order-control.js');
const today=()=>businessDay(new Date());
test.use({screenshot:'only-on-failure'});

async function setup(page,role='owner'){
 const data=await fullStack(page,role);
 const {db,master}=data;
 const yesterday=new Date(Date.parse(today()+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 Object.assign(db.tables.orders[0],{scheduled_date:yesterday,scheduled_time:'10:00'});
 Object.assign(db.tables.orders[1],{scheduled_date:nextDay(today()),scheduled_time:'12:00'});
 db.tables.orders.push(
  {id:'13',client:'Вера',work:'Монтаж',status:'В работе',master_staff_id:master.id,master_name:master.full_name,scheduled_date:yesterday,report_uploaded_at:new Date().toISOString(),report_review_status:'pending'},
  {id:'14',client:'<img src=x onerror=alert(1)>',work:'Исправление',status:'В работе',master_staff_id:master.id,master_name:master.full_name,report_review_status:'rejected',report_review_comment:'<script>не выполнять</script>'}
 );
 await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 if(role!=='master'){await page.waitForFunction(()=>!!window.BOS_ORDER_CONTROL);await page.locator('#bosOrderControlSummary').click();}
 return data;
}
for(const [role,width] of [['owner',1280],['dispatcher',360],['dispatcher',390],['manager',430]]){
 test(`order control: ${role} sees actionable queue at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});await setup(page,role);
  const panel=page.locator('#bosOrderControl');
  await expect(panel).toBeVisible();await expect(panel.locator('[data-oc-total]')).toHaveText('4');
  await expect(panel.locator('.ocItem')).toHaveCount(4);
  await expect(panel.locator('[data-oc-order="11"]')).toContainText('Прошёл день визита');
  await expect(panel.locator('[data-oc-order="12"]')).toContainText('Мастер не назначен');
  await expect(panel.locator('[data-oc-order="13"]')).not.toContainText('Прошёл день визита');
  await expect(panel.locator('[data-oc-order="14"]')).toContainText('<script>не выполнять</script>');
  await expect(panel.locator('img,script')).toHaveCount(0);
  await expect(page.locator('.ownerProblemsCompact')).toHaveCount(0);
  const metrics=page.locator('#content>.dashMetrics');
  if(await metrics.count()){
   const panelBox=await panel.boundingBox(),metricsBox=await metrics.boundingBox();
   expect(panelBox.y).toBeLessThan(metricsBox.y);
  }
  await page.screenshot({path:testInfo.outputPath(`order-control-${role}-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await panel.locator('[data-oc-filter="reports"]').click();await expect(panel.locator('.ocItem')).toHaveCount(2);
  await panel.locator('[data-oc-filter="master"]').click();await expect(panel.locator('.ocItem')).toHaveCount(1);
  await panel.locator('[data-oc-filter="all"]').click();
  await panel.locator('[data-oc-open="12"]').click();
  await expect(page.locator('#modalRoot .modal')).toBeVisible();
  await expect(page.locator('#modalRoot')).toContainText('Борис');
 });
}

test('order control clears resolved issues without rendering an idle loop',async({page})=>{
 const {db}=await setup(page);const panel=page.locator('#bosOrderControl');await expect(panel).toBeVisible();
 await page.evaluate(()=>{window.__ocNode=document.querySelector('#bosOrderControl .ocItem');window.BOS_ORDER_CONTROL.refresh();});
 await page.waitForTimeout(150);
 expect(await page.evaluate(()=>window.__ocNode===document.querySelector('#bosOrderControl .ocItem'))).toBe(true);
 db.tables.orders=[];await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await expect(panel.locator('.ocItem')).toHaveCount(0);await expect(panel.locator('[data-oc-total]')).toHaveText('0');
 await expect(panel).toContainText('По проверяемым условиям проблем не найдено.');
 await page.locator('nav [data-page="orders"]').click();await expect(panel).toHaveCount(0);
});

test('order control is hidden for master and performs no task writes',async({page})=>{
 const writes=[];
 page.on('request',request=>{
  if(request.method()!=='POST')return;
  try{const action=request.postDataJSON()?.action;if(['updateOrder','reviewReport','markCalled','confirmAgreement','setStage'].includes(action))writes.push(action);}catch{}
 });
 await setup(page,'master');
 await expect(page.locator('#bosOrderControl')).toHaveCount(0);expect(writes).toEqual([]);
});

test('order control disappears in master preview and after logout',async({page})=>{
 await setup(page);const panel=page.locator('#bosOrderControl');await expect(panel).toBeVisible();
 await page.evaluate(()=>{window.__ocPreview=isMasterPreview;window.isMasterPreview=()=>true;window.BOS_ORDER_CONTROL.refresh();});
 await expect(panel).toHaveCount(0);
 await page.evaluate(()=>{window.isMasterPreview=window.__ocPreview;show('home');window.BOS_ORDER_CONTROL.refresh();});
 await page.locator('#bosOrderControlSummary').click();await expect(panel).toBeVisible();
 await page.evaluate(()=>document.body.classList.remove('bos-auth-ok'));
 await expect(panel).toHaveCount(0);
});

test('order control pagination keeps every issue available',async({page})=>{
 const {db}=await setup(page);const panel=page.locator('#bosOrderControl');await expect(panel).toBeVisible();
 db.tables.orders=Array.from({length:16},(_,i)=>({id:String(100+i),client:'Клиент '+i,status:'В работе',scheduled_date:today(),scheduled_time:'10:00'}));
 await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await expect(panel.locator('[data-oc-total]')).toHaveText('16');await expect(panel.locator('.ocItem')).toHaveCount(12);
 await panel.locator('[data-oc-more]').click();await expect(panel.locator('.ocItem')).toHaveCount(16);
 await expect(panel.locator('[data-oc-more]')).toHaveCount(0);
});
