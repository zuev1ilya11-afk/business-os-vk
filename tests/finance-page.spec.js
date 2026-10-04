const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function ready(page,role='owner'){
 await page.clock.install({time:new Date('2026-10-04T09:00:00Z')});
 const ctx=await fullStack(page,role);const base=ctx.db.tables.orders[0];
 Object.assign(base,{status:'Выполнена',completed_at:'2026-10-04T08:00:00Z',source:'Авито',master_payout:600,extra_work_amount:100,city:'СПб',work:'Подрезка карниза по длине'});
 Object.assign(ctx.db.tables.orders[1],{status:'Выполнена',completed_at:'2026-09-01T08:00:00Z',city:'Москва',master_payout:1200,extra_work_amount:0});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 return ctx;
}
for(const role of ['owner','manager'])test(`${role} sees finances, filters and existing order details without writes`,async({page},info)=>{
 const {db}=await ready(page,role);
 await page.locator('nav [data-page="finance"]').click();
 const root=page.locator('#financePage');await expect(root).toBeVisible();
 await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('1 100');
 await expect(root.locator('[data-fin-kpi="pay"] strong')).toContainText('700');
 await expect(root.locator('[data-fin-kpi="company"] strong')).toContainText('400');
 await root.locator('[data-fin-master]').first().click();
 await expect(root.locator('#finMasterDetail')).toContainText('Тестовый мастер');
 await root.locator('[data-fin-order="11"]').first().click();await expect(page.locator('#modalRoot .modal')).toContainText('Анна');await page.locator('.modalClose').click();
 await root.locator('[data-fin-close-master]').click();
 await root.locator('[data-fin-period="year"]').click();await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('3 100');
 await root.locator('[data-fin-filter="city"]').selectOption('СПб');await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('1 100');
 for(const tab of ['orders','sources','works','periods','overview']){await root.locator(`[data-fin-tab="${tab}"]`).click();await expect(root.locator('[data-fin-tab].primary')).toHaveAttribute('data-fin-tab',tab)}
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`finance-${role}-${width}.png`),fullPage:true})}
 expect(db.calls.filter(c=>c.table==='orders'&&['update','insert','delete'].includes(c.mode))).toEqual([]);
});
for(const role of ['master','dispatcher'])test(`${role} cannot open finance through navigation or direct route`,async({page})=>{
 await ready(page,role);await expect(page.locator('nav [data-page="finance"]')).toBeHidden();
 await page.evaluate(()=>{location.hash='finance'});await expect(page.locator('#financePage')).toHaveCount(0);
 await page.evaluate(()=>{if(pages.finance)show('finance')});await expect(page.locator('#financePage')).toHaveCount(0);
});
test('finance refresh retains selected filters, detail and nodes, and logout clears it',async({page})=>{
 const {db}=await ready(page);await page.locator('nav [data-page="finance"]').click();
 const root=page.locator('#financePage');await root.locator('[data-fin-filter="city"]').selectOption('СПб');
 await root.locator('[data-fin-master]').first().click();
 await page.evaluate(()=>window.__finMetric=document.querySelector('[data-fin-kpi="revenue"] strong'));
 db.tables.orders[0].amount=1500;
 await page.evaluate(()=>BOS_REFRESH_NOW());
 await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('1 600');
 await expect(root.locator('#finMasterDetail')).toBeVisible();
 expect(await page.evaluate(()=>window.__finMetric===document.querySelector('[data-fin-kpi="revenue"] strong'))).toBe(true);
 await expect(root.locator('[data-fin-filter="city"]')).toHaveValue('СПб');
 await page.evaluate(()=>document.body.classList.remove('bos-auth-ok'));await expect(root).toHaveCount(0);
});
test('all period controls, combined filters, custom validation and search use the same totals',async({page})=>{
 const {master}=await ready(page);await page.locator('nav [data-page="finance"]').click();const root=page.locator('#financePage');
 for(const kind of ['today','week','month','quarter']){await root.locator(`[data-fin-period="${kind}"]`).click();await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('1 100')}
 await root.locator('[data-fin-period="yesterday"]').click();await expect(root.locator('[data-fin-kpi="completed"] strong')).toHaveText('0');
 await root.locator('[data-fin-period="all"]').click();await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('3 100');
 await root.locator('[data-fin-filter="master"]').selectOption(master.id);await root.locator('[data-fin-filter="source"]').selectOption('Авито');await root.locator('[data-fin-filter="work"]').selectOption('standard_020');
 await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('1 100');
 await root.locator('[data-fin-search]').fill('нет такого');await expect(root.locator('.finMasters')).toContainText('Мастера не найдены');
 await root.locator('[data-fin-search]').fill('Тестовый');await expect(root.locator('[data-fin-master]')).toHaveCount(3);
 await root.locator('[data-fin-period="custom"]').click();await root.locator('[name="from"]').fill('2026-10-04');await root.locator('[name="to"]').fill('2026-10-04');await root.locator('#finPeriodForm button').click();
 await expect(root.locator('[data-fin-kpi="revenue"] strong')).toContainText('1 100');
 await root.locator('[name="to"]').fill('2026-10-01');await root.locator('#finPeriodForm button').click();await expect(root.locator('.finError')).toContainText('начало не позже');
});
test('finance permission revocation and master preview hide existing finance data',async({page})=>{
 const {master}=await ready(page);await page.locator('nav [data-page="finance"]').click();
 await page.evaluate(()=>{state.settings.permissions.can_view_finance=false;BOS_FINANCE_PAGE.refresh()});await expect(page.locator('#financePage')).toHaveCount(0);
 await page.evaluate(()=>{state.settings.permissions.can_view_finance=true;show('finance')});await expect(page.locator('#financePage')).toBeVisible();
 await page.evaluate(id=>{enterMasterPreview(id);show('finance')},master.external_id);await expect(page.locator('#financePage')).toHaveCount(0);await expect(page.locator('nav [data-page="finance"]')).toBeHidden();
});
for(const action of ['switch','logout'])test(`finance immediately clears stale data after cross-tab ${action}`,async({page})=>{
 await ready(page);await page.locator('nav [data-page="finance"]').click();
 await page.locator('[data-fin-tab="orders"]').click();await page.locator('[data-fin-order="11"]').click();
 await expect(page.locator('[data-fin-snapshot]')).toBeVisible();
 await page.evaluate(action=>{sessionStorage.setItem('bos_vk_session_v2',localStorage.getItem('bos_vk_session_v2'));if(action==='switch')localStorage.setItem('bos_vk_session_v2','staff_other.other-session');else localStorage.setItem('bos_manual_logout_v1','1');window.dispatchEvent(new StorageEvent('storage',{key:action==='switch'?'bos_vk_session_v2':'bos_manual_logout_v1'}))},action);
 await expect(page.locator('#financePage')).toHaveCount(0);await expect(page.locator('nav [data-page="finance"]')).toHaveCount(0);await expect(page.locator('[data-fin-snapshot]')).toHaveCount(0);
 expect(await page.evaluate(()=>BOS_FINANCE_PAGE.allowed())).toBe(false);
 await page.evaluate(()=>show('finance'));await expect(page.locator('#financePage')).toHaveCount(0);
});
test('collapsed finance filters remain collapsed after background refresh',async({page})=>{
 await ready(page);await page.locator('nav [data-page="finance"]').click();await page.locator('.finFilters summary').click();
 await page.evaluate(()=>BOS_REFRESH_NOW());expect(await page.locator('.finFilters').evaluate(n=>n.open)).toBe(false);
});
