const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {employee}=require('./helpers/edge.cjs');
async function boot(page,role='manager',width=390){
 await page.setViewportSize({width,height:844});await page.clock.setFixedTime(new Date('2026-10-08T09:00:00Z'));
 const ctx=await fullStack(page,role);Object.assign(ctx.db.tables.orders[0],{status:'Выполнена',completed_at:'2026-10-08T08:00:00Z',scheduled_date:'2026-10-08',scheduled_time:'19:00',city:'Санкт-Петербург',extra_work_amount:100,report_review_status:'approved'});
 ctx.db.tables.business_staff.push(employee('d2','dispatcher',{full_name:'Мария Соколова'}),employee('boss','manager',{full_name:'Анна Волкова'}));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.waitForFunction(()=>document.body.classList.contains('bos-auth-ok')&&window.BOS_SESSION_API_READY);await page.evaluate(async role=>BOS_LOAD_ROLE_MODULES?.(role),role);await page.locator('#ownerDashboard').waitFor({state:'visible'});return ctx;
}
test('finance starts with seven tabs and compact filters retain values and disclosure after refresh',async({page})=>{
 await boot(page);await page.evaluate(()=>show('finance'));const root=page.locator('#financePage');
 await expect(root.locator('[data-fin-tab]')).toHaveCount(7);await expect(root.locator('.finPeriodControl')).toBeVisible();
 expect(await root.locator('.finFilters').evaluate(e=>e.open)).toBe(false);
 expect((await root.locator('.finTabs').boundingBox()).y).toBeLessThan((await root.locator('.finKpis').first().boundingBox()).y);
 await root.locator('.finFilters summary').click();await root.getByLabel('Город',{exact:true}).selectOption('Санкт-Петербург');
 await root.locator('.finFilters summary').click();await page.evaluate(()=>BOS_REFRESH_NOW());expect(await root.locator('.finFilters').evaluate(e=>e.open)).toBe(false);
 await root.locator('.finFilters summary').click();await expect(root.getByLabel('Город',{exact:true})).toHaveValue('Санкт-Петербург');await expect(root.locator('.finFilters summary')).toContainText('1');
});
test('financial mobile records have labels, saved values and no inferred paid balance',async({page})=>{
 await boot(page);await page.evaluate(()=>show('finance'));await page.locator('[data-fin-tab=orders]').click();const row=page.locator('[data-fin-key="order:11"]');await expect(row).toContainText('1 100');await expect(row.locator('[data-label="Начислено мастеру"]')).toContainText('652,5');
 expect(await row.locator('[data-label="Начислено мастеру"]').evaluate(e=>getComputedStyle(e,'::before').content)).toContain('Начислено мастеру');
 await page.locator('[data-fin-tab=masters]').click();await expect(page.locator('#finContent')).toContainText('Фактически выплачено: —');
});
test('manager dashboard attention is actionable and financial base revenue remains distinct',async({page})=>{
 await boot(page);await expect(page.locator('.bosManagementHeading h1')).toHaveText('Обзор работы');await expect(page.locator('.bosManagementAttention [data-oc-home-filter=unassigned]')).toBeVisible();await expect(page.locator('[data-owner-kpi=revenue] strong')).toContainText('1 000');
 await page.locator('.bosManagementAttention [data-oc-home-filter=unassigned]').click();await expect(page.locator('[data-oc-order="12"]')).toBeVisible();await expect(page.locator('[data-oc-order="11"]')).toHaveCount(0);
});
test('manager employee composition keeps contact visits and permitted actions without owner login tools',async({page})=>{
 await boot(page);await page.evaluate(()=>show('team'));await expect(page.getByRole('button',{name:'+ Сотрудник',exact:true})).toHaveCount(0);await expect(page.locator('.bosManagementTeam')).toBeVisible();await page.evaluate(()=>openEmployeeProfile('staff_m'));await expect(page.locator('.bosManagementMember')).toBeVisible();await expect(page.locator('.staffAdminActions')).toBeVisible();await expect(page.locator('#modalRoot input[type=password]')).toHaveCount(0);await expect(page.locator('#modalRoot')).toContainText('Фактически выплачено: —');
});
test('report review has explicit comment label, documents and unchanged rejection validation',async({page})=>{
 const {db}=await boot(page);Object.assign(db.tables.orders[1],{report_uploaded_at:'2026-10-08T08:00:00Z',report_review_status:'pending',report_upload_token:'t'});await page.evaluate(()=>BOS_REFRESH_NOW());await page.evaluate(()=>openReportReview('12'));await expect(page.locator('.bosManagementReview')).toBeVisible();await expect(page.getByLabel('Комментарий проверяющего')).toBeVisible();await page.locator('#rejectReportBtn').click();await expect(page.locator('#reviewMsg')).toContainText('Укажите причину');
});
for(const width of [360,430,768,1440])test(`seven finance tabs remain contained at ${width}`,async({page})=>{
 await boot(page,'manager',width);await page.evaluate(()=>show('finance'));for(const tab of ['overview','expenses','masters','orders','sources','works','periods']){await page.locator(`[data-fin-tab=${tab}]`).click();await expect(page.locator('[data-fin-tab].primary')).toHaveAttribute('data-fin-tab',tab);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),tab).toBeLessThanOrEqual(1)}
});

test('manager header profile shows the role profile with the existing login-settings entry',async({page})=>{await boot(page);await page.locator('#profileBtn').click();await expect(page.locator('.bosManagementProfile')).toBeVisible();await page.getByRole('button',{name:'Настройки входа →'}).click();await expect(page.locator('#modalRoot')).toContainText('Настройки входа');await page.locator('.modalClose').click();await expect(page.locator('#modalRoot .modal')).toHaveCount(0);await page.locator('#profileBtn').click();await expect(page.locator('.bosManagementProfile')).toBeVisible()});
for(const role of ['owner','manager'])test(`${role} desktop employee rows do not compress or overlap and open the real profile`,async({page})=>{
 await boot(page,role,1440);await page.evaluate(()=>show('team'));const rows=page.locator('.bosManagementTeam .compactTeamCard');await expect(rows).toHaveCount(role==='owner'?3:4);
 const list=await page.locator('.bosManagementTeam .compactTeam').boundingBox(),boxes=await rows.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));
 for(let i=0;i<boxes.length;i++){expect(boxes[i].width).toBeGreaterThanOrEqual(list.width-1);if(i)expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i-1].y+boxes[i-1].height-1)}
 await rows.filter({hasText:'Тестовый мастер'}).click();await expect(page.locator('.bosManagementMember')).toBeVisible();await expect(page.locator('#modalRoot')).toContainText('Тестовый мастер');
});
