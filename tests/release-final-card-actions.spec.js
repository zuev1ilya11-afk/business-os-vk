const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function boot(page,role,width=390,seed=()=>{}){
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.setViewportSize({width,height:900});await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'));
 const ctx=await fullStack(page,role);await seed(ctx);
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok'));
 await page.evaluate(()=>{window.__opens=[];for(const name of ['openOrder','openReportReview','dispatchControlV24Select']){const original=window[name];if(original)window[name]=function(...args){window.__opens.push({name,id:String(args[0])});return original.apply(this,args)}}});
 return ctx;
}
async function opens(page,name,id,count=1){await expect.poll(()=>page.evaluate(({name,id})=>window.__opens.filter(x=>x.name===name&&x.id===id).length,{name,id})).toBe(count)}
test('master home avatar reaches canonical profile instead of credentials',async({page})=>{
 await boot(page,'master');await page.locator('#profileBtn').click();
 await expect(page.locator('.bosProfileIdentity')).toBeVisible();await expect.poll(()=>page.evaluate(()=>state.page)).toBe('team');await expect(page.locator('#bosCredForm')).toHaveCount(0);await page.getByRole('button',{name:/Настройки входа/}).click();await expect(page.locator('#bosCredForm')).toBeVisible();
});
test('dispatcher attention card opens once and inner review preserves review route',async({page})=>{
 await boot(page,'dispatcher',390,({db})=>Object.assign(db.tables.orders[0],{scheduled_date:'2026-10-07',report_uploaded_at:'2026-10-08T08:00:00Z',report_review_status:'pending'}));
 await page.getByRole('button',{name:/Требуют внимания .*Открыть заявки/}).click();
 const card=page.locator('[data-ops-attention-order="11"]');await card.locator('h3').click();await opens(page,'openOrder','11');
 await page.evaluate(()=>closeModal());await card.getByRole('button',{name:'Проверить отчёт',exact:true}).click();await opens(page,'openReportReview','11');await opens(page,'openOrder','11');
});
for(const kind of ['unassigned','control'])test(`dispatcher ${kind} whole card delegates exactly once`,async({page})=>{
 await boot(page,'dispatcher',1440);await page.locator('nav [data-page=orders]').click();
 if(kind==='unassigned'){
  await page.getByRole('button',{name:'Список',exact:true}).click();await page.locator('.duq122Item[data-order-id="12"] .duq122Main').click();await opens(page,'openOrder','12');
 }else{
  await page.locator('.dbV24Tab').filter({hasText:'Контроль'}).click();await page.locator('.dbV24Card[data-order-id="12"] .dbV24CardTop').click();await opens(page,'dispatchControlV24Select','12');
  await expect(page.locator('#dispatchBoardDetail')).toContainText('Другой адрес');
 }
});
test('pending control card delegates to report review, not order detail',async({page})=>{
 await boot(page,'owner',390,({db})=>Object.assign(db.tables.orders[0],{report_uploaded_at:'2026-10-08T08:00:00Z',report_review_status:'pending'}));
 await page.locator('#bosOrderControlSummary [data-oc-enter]').click();await page.locator('[data-oc-order="11"] .ocClient').click();
 await opens(page,'openReportReview','11');await opens(page,'openOrder','11',0);await expect(page.locator('#modalRoot')).toContainText('Проверка отчёта 11');
});
test('completed finance row preserves the native financial snapshot',async({page})=>{
 await boot(page,'manager',390,({db})=>Object.assign(db.tables.orders[0],{status:'Выполнена',completed_at:'2026-10-08T08:00:00Z',report_review_status:'approved'}));
 await page.locator('nav [data-page=finance]').click();await page.locator('[data-fin-tab=orders]').click();
 await page.locator('[data-fin-key="order:11"] [data-label="Работы"]').click();await expect(page.locator('[data-fin-snapshot]')).toBeVisible();await opens(page,'openOrder','11');
});

test('master personal task whole card opens once and nested open stays single',async({page})=>{
 await boot(page,'master',390,async({me})=>{
  await page.route(/\/(?:api\/proxy|functions\/v1)\/push-api(?:\?|$)/,async route=>{
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
   const b=route.request().postDataJSON();if(b.action!=='controlList')return route.fallback();
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,tasks:[{id:'t1',order_id:'11',issue_code:'agreement',assignee_id:me.id,assignee_name:me.full_name,due_at:'2026-10-08T11:00:00Z',version:1,active:true,reminder_status:'off'}],staff:[],reminders_enabled:true,more:false})});
  });
 });
 const card=page.locator('.ctOwn');await card.locator('b').first().click();await opens(page,'openOrder','11');await expect(page.locator('.bosCompactMasterCard')).toBeVisible();await page.evaluate(()=>closeModal());await card.getByRole('button',{name:'Открыть заявку'}).click();await opens(page,'openOrder','11',2);
});
