const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

async function ready(page,role='owner'){
 const data=await fullStack(page,role);
 await page.goto('/');
 await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>!!window.BOS_ORDER_CONTROL);
 return data;
}
test('home has only a compact unique-order indicator and opens the Orders control section',async({page},info)=>{
 const {db}=await ready(page);
 const summary=page.locator('#bosOrderControlSummary'),navCount=await page.locator('nav button').count();
 await expect(summary).toContainText('2 требуют внимания');
 await expect(page.locator('#bosOrderControl,.ocItem,.ocFilters,.ctMeta')).toHaveCount(0);
 for(const width of [360,390,430,1280]){
  await page.setViewportSize({width,height:900});
  await expect(summary).toBeVisible();
  expect((await summary.boundingBox()).height).toBeLessThan(width<600?240:150);
  const metrics=await page.locator('#ownerDashboard>.dashMetrics').boundingBox(),load=await page.locator('#ownerDashboard .odLoad').boundingBox();
  expect(metrics.y).toBeLessThan(load.y);
  if(width>=1024)expect((await page.locator('#ownerDashboard .odTodayList').boundingBox()).y).toBeCloseTo(load.y,0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`control-home-${width}.png`)});
 }
 await summary.locator('[data-oc-enter]').click();
 await expect(page.locator('#bosOrderControl')).toBeVisible();
 await expect(page.locator('#bosOrderControl .ocItem')).toHaveCount(2);
 await expect(page.locator('nav [data-page="orders"]')).toHaveClass(/active/);
 await expect(page.locator('nav button')).toHaveCount(navCount);
 await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
 await page.locator('[data-oc-back]').click();
 await expect(page.locator('#bosOrderControl')).toHaveCount(0);
 await page.locator('#bosOrderControlEntry').click();
 await expect(page.locator('#bosOrderControl')).toBeVisible();
 expect(db.calls.filter(c=>c.table==='orders'&&['update','insert','delete'].includes(c.mode))).toEqual([]);
});

test('background refresh retains a successful empty snapshot, then marks it stale on error',async({page})=>{
 const {db}=await ready(page);
 db.tables.orders.length=0;
 await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await expect(page.locator('#bosOrderControlSummary')).toContainText('Всё в порядке');
 let release;const held=new Promise(resolve=>release=resolve);
 await page.route(/\/(?:api\/proxy|functions\/v1)\/mini-app-api(?:\?|$)/,async route=>{
  if(route.request().postDataJSON()?.action!=='bootstrap')return route.fallback();
  await held;
  await route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"Сеть недоступна"}'});
 });
 await page.evaluate(()=>{window.__controlRefresh=window.BOS_REFRESH_NOW()});
 await expect(page.locator('#bosOrderControlSummary')).toContainText('Всё в порядке');
 await expect(page.locator('#bosOrderControlSummary')).not.toContainText('Загрузка');
 await expect(page.locator('#ownerDashboard')).toHaveAttribute('aria-busy','false');
 release();
 await page.evaluate(()=>window.__controlRefresh);
 await expect(page.locator('#bosOrderControlSummary')).toContainText('Не удалось обновить');
 await expect(page.locator('#ownerDashboard')).toHaveAttribute('aria-busy','false');
 await page.evaluate(()=>show('home'));
 await expect(page.locator('#ownerDashboard .odRefreshState')).toBeVisible();
 await expect(page.locator('#bosOrderControlSummary')).not.toContainText('Всё в порядке');
});

test('control filter and scroll survive order close and section return, then reset on preview and identity changes',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 const {db}=await ready(page);
 db.tables.orders=Array.from({length:18},(_,i)=>({id:String(200+i),client:'Клиент '+i,work:'Монтаж',status:'В работе',scheduled_date:'2020-01-01',scheduled_time:'10:00'}));
 await page.evaluate(()=>window.BOS_REFRESH_NOW());
 await page.locator('#bosOrderControlSummary [data-oc-enter], button#bosOrderControlSummary').click();
 const panel=page.locator('#bosOrderControl');
 await panel.locator('[data-oc-filter="urgent"]').click();
 await panel.locator('[data-oc-more]').click();
 await expect(panel.locator('.ocItem')).toHaveCount(18);
 await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target.closest('[data-oc-open]'))window.__beforeOrderScroll=scrollY},true));
 await panel.locator('[data-oc-open="207"]').click();
 const before=await page.evaluate(()=>window.__beforeOrderScroll);
 await expect(page.locator('#modalRoot .modal')).toBeVisible();
 await page.locator('#modalRoot .modalClose').click();
 await expect(panel.locator('[data-oc-filter="urgent"]')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(before,0);
 await page.locator('nav [data-page="home"]').click();
 await page.locator('#bosOrderControlSummary [data-oc-enter], button#bosOrderControlSummary').click();
 await expect(panel.locator('[data-oc-filter="urgent"]')).toHaveAttribute('aria-pressed','true');
 await expect(panel.locator('.ocItem')).toHaveCount(18);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(before,0);
 await page.evaluate(()=>{window.__oldPreview=isMasterPreview;window.isMasterPreview=()=>true;window.BOS_ORDER_CONTROL.refresh()});
 await expect(panel).toHaveCount(0);
 await page.evaluate(()=>{window.isMasterPreview=window.__oldPreview;show('home');window.BOS_ORDER_CONTROL.refresh()});
 await page.locator('#bosOrderControlSummary [data-oc-enter], button#bosOrderControlSummary').click();
 await expect(panel.locator('[data-oc-filter="all"]')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>{state.user={...state.user,id:'other-user',external_id:'other'};window.BOS_ORDER_CONTROL.refresh()});
 await expect(page.locator('.ocItem')).toHaveCount(0);
 await expect(page.locator('#bosOrderControlSummary')).toHaveCount(0);
});

test('leaving a preview during its pending verification loads the current identity without showing stale rows',async({page})=>{
 const {db}=await ready(page);
 db.tables.orders.push({id:'13',client:'Новая заявка после входа',work:'Монтаж',status:'В работе'});
 let release;const held=new Promise(resolve=>release=resolve);let requests=0;
 await page.route(/\/(?:api\/proxy|functions\/v1)\/mini-app-api(?:\?|$)/,async route=>{
  if(route.request().postDataJSON()?.action!=='bootstrap')return route.fallback();
  if(++requests===1)await held;
  await route.fallback();
 });
 await page.evaluate(()=>{window.__ocManagerPreview=BOS_IS_MANAGER_PREVIEW;window.BOS_IS_MANAGER_PREVIEW=()=>true;window.BOS_ORDER_CONTROL.refresh()});
 const summary=page.locator('#bosOrderControlSummary');
 await expect(summary).toContainText('Загрузка');
 await expect.poll(()=>requests).toBe(1);
 await page.evaluate(()=>{window.BOS_IS_MANAGER_PREVIEW=window.__ocManagerPreview;window.BOS_ORDER_CONTROL.refresh()});
 await expect(summary).toContainText('Загрузка');
 release();
 await expect(summary).toContainText('3 требуют внимания');
 await expect(page.locator('.ocItem')).toHaveCount(0);
 await summary.locator('[data-oc-enter]').click();
 await page.locator('[data-oc-open="13"]').click();
 await expect(page.locator('#modalRoot .modal')).toContainText('Новая заявка после входа');
});
