const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function setup(page){
 await page.clock.install({time:new Date('2026-10-04T09:00:00Z')});
 const ctx=await fullStack(page,'owner');ctx.db.tables.finance_expenses=[];
 Object.assign(ctx.db.tables.orders[0],{status:'Выполнена',completed_at:'2026-10-04T08:00:00Z',source:'Авито',master_payout:600,extra_work_amount:0,city:'Москва'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page="finance"]').click();
 await expect(page.locator('[data-fin-kpi="expenses"] strong')).toContainText('0');return {...ctx,errors};
}
test('expense CRUD updates summary, category list and net profit without losing selected period',async({page})=>{
 const {db,errors}=await setup(page),root=page.locator('#financePage');
 await root.locator('[data-fin-period="today"]').click();await root.getByRole('button',{name:'+ Добавить расход',exact:true}).click();
 const form=page.locator('#finExpenseForm');await expect(form).toBeVisible();
 await form.locator('[name="amount"]').fill('125.50');await form.locator('[name="category"]').selectOption('avito');await form.locator('[name="comment"]').fill('Пополнение тарифа');await form.getByRole('button',{name:'Добавить расход',exact:true}).click();
 await expect(form).toHaveCount(0);await expect(root.locator('[data-fin-kpi="expenses"] strong')).toContainText('125,5');await expect(root.locator('[data-fin-kpi="net"] strong')).toContainText('274,5');
 expect(db.tables.orders[0].master_payout).toBe(600);await expect(root.locator('[data-fin-period="today"]')).toHaveClass(/primary/);
 await root.locator('[data-fin-tab="expenses"]').click();await expect(root.locator('.finExpenseList')).toContainText('Пополнение тарифа');
 await root.locator('[data-fin-expense-edit]').click();await form.locator('[name="amount"]').fill('200');await form.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(root.locator('[data-fin-kpi="net"] strong')).toContainText('200');await expect(root.locator('.finExpenseCategories')).toContainText('Авито');
 await root.locator('[data-fin-expense-delete]').click();await expect(page.locator('#finExpenseDeleteForm')).toBeVisible();await page.locator('#finExpenseDeleteForm button[type="submit"]').click();
 await expect(root.locator('[data-fin-kpi="expenses"] strong')).toContainText('0');expect(db.tables.finance_expenses).toHaveLength(0);expect(errors).toEqual([]);
});
test('expense editor draft, focus, period and scroll survive background refresh; mobile fits',async({page})=>{
 const {errors}=await setup(page),root=page.locator('#financePage');
 await root.locator('[data-fin-tab="expenses"]').click();await root.locator('[data-fin-period="year"]').click();
 for(const width of [320,360,390,430,1440]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
 await root.getByRole('button',{name:'+ Добавить расход',exact:true}).click();const form=page.locator('#finExpenseForm');await form.locator('[name="comment"]').fill('Черновик расхода');
 await page.evaluate(()=>BOS_REFRESH_NOW());await expect(form.locator('[name="comment"]')).toHaveValue('Черновик расхода');await expect(form.locator('[name="comment"]')).toBeFocused();await expect(root.locator('[data-fin-period="year"]')).toHaveClass(/primary/);
 await page.setViewportSize({width:320,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('.modalClose').click();await page.evaluate(()=>scrollTo(0,120));const y=await page.evaluate(()=>scrollY);await page.evaluate(()=>BOS_REFRESH_NOW());expect(await page.evaluate(()=>scrollY)).toBe(y);expect(errors).toEqual([]);
});
test('failed expense save retains the form and account revocation removes financial modal',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'+ Добавить расход',exact:true}).click();const form=page.locator('#finExpenseForm');
 await form.locator('[name="amount"]').fill('100');await form.locator('[name="category"]').selectOption('other');await form.getByRole('button',{name:'Добавить расход',exact:true}).click();await expect(form.locator('[role="status"]')).toContainText('описание');
 await page.evaluate(()=>{state.settings.permissions.can_view_finance=false;BOS_FINANCE_PAGE.refresh()});await expect(form).toHaveCount(0);await expect(page.locator('#financePage')).toHaveCount(0);
});
test('expense load failure is explicit, keeps known totals and retries without a request loop',async({page})=>{
 await setup(page);await page.evaluate(()=>{window.expenseCalls=0;window.baseExpenseApi=window.api;window.api=async(a,p)=>{if(a==='listExpenses'){window.expenseCalls++;return {ok:false,error:'Нет связи с сервером'}}return window.baseExpenseApi(a,p)}});
 await page.evaluate(()=>window.dispatchEvent(new Event('bos:employee-data-refreshed')));await expect(page.locator('.finExpenseError')).toContainText('Нет связи с сервером');
 expect(await page.evaluate(()=>expenseCalls)).toBe(1);await expect(page.locator('[data-fin-kpi="expenses"] strong')).toContainText('0');
 await page.evaluate(()=>window.api=window.baseExpenseApi);await page.getByRole('button',{name:'Повторить загрузку расходов'}).click();await expect(page.locator('.finExpenseError')).toBeHidden();
});
test('expenses use their own dates, appear in expense-only periods and compare with last period',async({page})=>{
 const {db}=await setup(page);db.tables.finance_expenses.push({id:'b1b34875-2935-4e79-93e2-1c6b5a135b08',expense_date:'2026-10-04',amount:100,category:'rent',created_at:'2026-10-04T01:00:00Z',created_by_name:'Владелец'},{id:'b1b34875-2935-4e79-93e2-1c6b5a135b09',expense_date:'2026-09-02',amount:50,category:'tools',created_at:'2026-09-02T01:00:00Z',created_by_name:'Владелец'});
 await page.evaluate(()=>window.dispatchEvent(new Event('bos:employee-data-refreshed')));await expect(page.locator('[data-fin-kpi="expenses"]')).toContainText('+100%');await expect(page.locator('[data-fin-kpi="net"] strong')).toContainText('300');
 await page.locator('[data-fin-period="all"]').click();await expect(page.locator('[data-fin-kpi="expenses"] strong')).toContainText('150');await page.locator('[data-fin-tab="periods"]').click();await page.locator('[data-fin-group="day"]').click();await expect(page.locator('[data-fin-key="group:2026-09-02"]')).toContainText('−50'.replace('−','-'));
 Object.assign(db.tables.orders[0],{source:'Hands',external_source:'hands'});await page.evaluate(()=>BOS_REFRESH_NOW());await expect(page.locator('[data-fin-kpi="net"] strong')).toHaveText('—');
});
test('editing an expense preserves its inactive employee link',async({page})=>{
 const {db}=await setup(page),employeeId='b1b34875-2935-4e79-93e2-1c6b5a135b10';
 db.tables.business_staff.push({id:employeeId,full_name:'Бывший сотрудник',is_active:false,role:'master'});
 db.tables.finance_expenses.push({id:'b1b34875-2935-4e79-93e2-1c6b5a135b08',expense_date:'2026-10-04',amount:100,category:'office_salary',comment:'Зарплата',employee_id:employeeId,created_at:'2026-10-04T01:00:00Z',updated_at:'2026-10-04T01:00:00Z',created_by_name:'Владелец',created_by_staff_id:'owner'});
 await page.evaluate(()=>window.dispatchEvent(new Event('bos:employee-data-refreshed')));await expect(page.locator('[data-fin-kpi="expenses"] strong')).toContainText('100');await page.locator('[data-fin-tab="expenses"]').click();await page.locator('[data-fin-expense-edit]').click();
 const form=page.locator('#finExpenseForm');await expect(form.locator('[name="employee_id"]')).toHaveValue(employeeId);await form.locator('[name="amount"]').fill('150');await form.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(form).toHaveCount(0);expect(db.tables.finance_expenses[0].employee_id).toBe(employeeId);
});
test('an expense-only city is available in the existing city filter',async({page})=>{
 const {db}=await setup(page);db.tables.finance_expenses.push({id:'b1b34875-2935-4e79-93e2-1c6b5a135b08',expense_date:'2026-10-04',amount:100,category:'rent',city:'Казань',created_at:'2026-10-04T01:00:00Z',created_by_name:'Владелец'});
 await page.evaluate(()=>window.dispatchEvent(new Event('bos:employee-data-refreshed')));await expect(page.locator('[data-fin-kpi="expenses"] strong')).toContainText('100');
 await expect(page.locator('[data-fin-filter="city"] option[value="Казань"]')).toHaveCount(1);await page.locator('[data-fin-filter="city"]').selectOption('Казань');await expect(page.locator('[data-fin-kpi="expenses"] strong')).toContainText('100');await expect(page.locator('[data-fin-kpi="net"] strong')).toContainText('-100');
});
