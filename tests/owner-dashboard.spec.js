const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function ready(page,role='owner'){
 await page.clock.install({time:new Date('2026-10-04T09:00:00Z')});
 const ctx=await fullStack(page,role);
 Object.assign(ctx.db.tables.orders[0],{scheduled_date:'2026-10-04',scheduled_time:'09:00',master_workflow_stage:'started'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.waitForFunction(()=>!!window.BOS_ORDER_CONTROL);
 return ctx;
}
for(const role of ['owner','manager'])test(role+' gets a rolling dashboard and working links without writes',async({page},info)=>{
 const {db}=await ready(page,role);
 const dashboard=page.locator('#ownerDashboard');await expect(dashboard).toBeVisible();
 await expect(dashboard.locator('thead th[data-date]')).toHaveCount(7);
 await expect(dashboard.locator('thead th[data-date]').first()).toHaveAttribute('data-date','2026-10-04');
 await expect(dashboard.locator('thead th[data-date]').nth(1)).toHaveAttribute('data-date','2026-10-05');
 await expect(dashboard.locator('[data-owner-kpi="today"]')).toContainText('1');
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const table=dashboard.locator('.odTable');
  expect(await table.evaluate(el=>getComputedStyle(el).display)).toBe('table');
  if(width<600){
   await dashboard.locator('.odTableScroll').evaluate(el=>el.scrollLeft=el.scrollWidth);
   const last=await dashboard.locator('thead th[data-date]').last().boundingBox();
   expect(last.x+last.width).toBeLessThanOrEqual(width);
   await dashboard.locator('.odTableScroll').evaluate(el=>el.scrollLeft=0);
  }
  await page.screenshot({path:info.outputPath(`dashboard-${role}-${width}.png`),fullPage:true});
 }
 await dashboard.locator('[data-owner-order="11"]').click();await expect(page.locator('#modalRoot .modal')).toContainText('Анна');await page.locator('.modalClose').click();
 await page.locator('[data-oc-home-filter="unassigned"]').click();await expect(page.locator('.ocItem')).toHaveCount(1);await expect(page.locator('.ocItem')).toContainText('Борис');
 await page.evaluate(()=>show('home'));await dashboard.getByRole('button',{name:'+ Новая заявка',exact:true}).click();await expect(page.locator('#orderForm')).toBeVisible();await page.locator('.modalClose').click();
 await dashboard.getByRole('button',{name:'Мастера',exact:true}).click();await expect(page.locator('nav [data-page="team"]')).toHaveClass(/active/);
 expect(db.calls.filter(c=>c.table==='orders'&&['update','insert','delete'].includes(c.mode))).toEqual([]);
});
test('empty data, stored zero pay, conflicts and contact indicator remain factual',async({page})=>{
 const {db}=await ready(page);
 const base=db.tables.orders[0];
 db.tables.orders.push({...base,id:'13',scheduled_time:'09:30'});
 await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(page.locator('#ownerDashboard .odDay.conflict')).toHaveCount(1);
 Object.assign(base,{status:'Выполнена',completed_at:'2026-10-04T09:00:00Z',report_review_status:'approved',master_payout:0,amount:1000});
 Object.assign(db.tables.orders[2],{master_workflow_stage:'assigned',master_called_at:'2026-10-04T08:00:00Z'});
 await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(page.locator('[data-owner-finance="pay"]')).toContainText('0 ₽');
 await expect(page.locator('[data-owner-finance="company"]')).toHaveCount(0);
 await expect(page.locator('[data-oc-home-filter="contact"] b')).toHaveText('0');
 db.tables.orders.length=0;await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(page.locator('#ownerDashboard')).toContainText('На сегодня заявок нет');
 await expect(page.locator('#ownerDashboard')).not.toContainText(/undefined|NaN|Invalid Date/);
});
test('today refreshes after Moscow midnight without another request',async({page})=>{
 await ready(page);
 await page.clock.setSystemTime(new Date('2026-10-04T21:01:00Z'));
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'))});
 await expect(page.locator('#ownerDashboard thead th[data-date]').first()).toHaveAttribute('data-date','2026-10-05');
});

test('many masters, truthful schedule colors and report/correction lists stay usable',async({page},info)=>{
 const {employee}=require('./helpers/edge.cjs');
 await page.clock.install({time:new Date('2026-10-04T09:00:00Z')});
 const {db,master}=await fullStack(page,'owner');
 const masters=[master,...Array.from({length:24},(_,i)=>employee('long'+i,'master',{full_name:'Александр Константинопольский '+i}))];
 db.tables.business_staff.push(...masters.slice(1));
 db.tables.staff_schedule=masters.map((m,i)=>({id:'s'+i,staff_id:m.id,work_date:'2026-10-04',is_working:i<20,work_start:'10:00',work_end:'20:00'}));
 Object.assign(db.tables.orders[0],{scheduled_date:'2026-10-04',scheduled_time:'10:00'});
 db.tables.orders.push({...db.tables.orders[0],id:'21',status:'Выполнена',completed_at:'2026-10-04T08:00:00Z',source:'Телефон',external_source:'mini_app',master_payout:0,report_review_status:'approved',uncompleted_work_amount:100,uncompleted_work_description:'Не выполнена установка штор'});
 db.tables.orders.push({...db.tables.orders[0],id:'22',report_uploaded_at:'2026-10-03T21:30:00Z',report_review_status:'pending',report_upload_token:'dashboard-report',amount:1000});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 const root=page.locator('#ownerDashboard');
 await expect(root.locator('tbody tr')).toHaveCount(25);
 await page.evaluate(()=>{state.settings.reports_drive_folder_url='https://drive.google.com/drive/folders/archive';show('home')});
 await expect(root.getByRole('link',{name:'Архив отчётов ↗'})).toHaveAttribute('href','https://drive.google.com/drive/folders/archive');
 await expect(root.locator('.odDay.free')).toHaveCount(19);
 await expect(root.locator('[data-owner-kpi="masters"]')).toContainText('20');
 await expect(root.locator('[data-owner-finance="company"]')).toContainText('1 000');
 await page.evaluate(()=>{const o=state.orders.find(o=>o.id==='11');o.report_review_status='rejected';o.report_uploaded_at='2026-10-04T08:00:00Z';show('home')});
 await expect(root.locator('[data-owner-order="11"]')).toContainText('Отчёт отклонён');
 await root.locator('[data-owner-day="2026-10-04"]').first().click();await expect(page.locator('.modal')).toContainText('Тестовый мастер');await page.locator('.modalClose').click();
 await root.locator('[data-owner-list="reports"]').click();await expect(page.locator('.modal [data-owner-review="22"]')).toBeVisible();await page.locator('.modalClose').click();
 await root.locator('[data-owner-list="corrections"]').click();await expect(page.locator('.modal')).toContainText('Не выполнена установка штор');await page.locator('.modalClose').click();
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`dashboard-populated-${width}.png`),fullPage:true})}
 db.tables.business_staff=db.tables.business_staff.filter(m=>m.role!=='master');db.tables.orders=[];db.tables.staff_schedule=[];
 await page.evaluate(()=>BOS_REFRESH_NOW());await expect(root).toContainText('Мастеров пока нет.');
});
