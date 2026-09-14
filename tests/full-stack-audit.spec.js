const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
test('order search and combined master/source filters affect rendered rows and reset',async({page})=>{
 await fullStack(page);await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=orders]').click();
 await page.locator('#bosOrderSearch').fill('Анна');await expect(page.locator('.bosFilteredOrder')).toHaveCount(1);await expect(page.locator('.bosFilteredOrder')).toContainText('Анна');
 await page.locator('#bosOrderSource').selectOption('Авито');await expect(page.locator('.bosFilteredOrder')).toHaveCount(0);
 await page.getByRole('button',{name:/^Все \d/}).click();await expect(page.locator('.bosFilteredOrder')).toHaveCount(2);
 await page.locator('#bosOrderMaster').selectOption('Тестовый мастер');await expect(page.locator('.bosFilteredOrder')).toHaveCount(1);
});
for(const width of [320,375,390,1280])test(`master real handler bootstrap fits ${width}px and hides admin`,async({page})=>{
 await page.setViewportSize({width,height:844});await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible();
 await expect(page.getByRole('button',{name:'Логины и пароли'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
test('dispatcher creates and assigns order through handler, then sees assignment after reload',async({page})=>{
 const {db}=await fullStack(page,'dispatcher');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=orders]').click();await page.getByRole('button',{name:'+ Новая'}).click();
 await page.locator('[name=client]').fill('Заказ аудита');await page.locator('#bosPhone').fill('9991234567');await page.locator('[name=address]').fill('Длинный адрес аудита, дом 123');await page.locator('#bosService').selectOption('4');await page.locator('[name=original_amount]').fill('1000');await page.locator('[name=master_vk_id]').selectOption('staff_m');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.locator('#orderForm')).toHaveCount(0);expect(db.tables.orders).toHaveLength(3);const order=db.tables.orders.find(x=>x.client==='Заказ аудита');expect(order.master_staff_id).toBe('m');expect(order.master_payout).toBe(552.5);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=orders]').click();await page.locator('#bosOrderSearch').fill('Заказ аудита');await expect(page.locator('.bosFilteredOrder')).toHaveCount(1);await expect(page.locator('.bosFilteredOrder')).toContainText('Тестовый мастер');
});
test('owner settings and team modals open and close without page errors',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await fullStack(page);await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.getByRole('button',{name:'Инструменты владельца'}).click();await expect(page.locator('.modal')).toBeVisible();await page.locator('.modalClose').click();await expect(page.locator('.modal')).toHaveCount(0);await page.locator('nav [data-page=team]').click();await page.getByRole('button',{name:'Логины и пароли'}).click();await expect(page.locator('.modal')).toContainText('Тестовый мастер');await page.getByRole('button',{name:'Закрыть',exact:true}).click();expect(errors).toEqual([]);
});
test('master calendar presets save and reload through actual handler',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const {db}=await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=dispatch]').click();await page.locator('[data-compact-kind=all]').click();await expect(page.locator('.bosCalDay:not(.working)')).toHaveCount(0);await page.getByRole('button',{name:'Сохранить график'}).click();await expect.poll(()=>db.tables.staff_schedule.filter(x=>x.is_working).length).toBeGreaterThan(27);await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=dispatch]').click();await expect(page.locator('.bosCalDay:not(.working)')).toHaveCount(0);await page.getByRole('button',{name:'Этот месяц'}).click();expect(errors).toEqual([]);
});
test('manager adds memo text and sees it after reopening',async({page})=>{
 const {db}=await fullStack(page,'manager');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=team]').click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.locator('#managerMemoForm [name=title]').fill('Памятка аудита');await page.locator('#managerMemoForm [name=note]').fill('Проверить крепления');await page.getByRole('button',{name:'Добавить в памятку'}).click();await expect(page.locator('#managerMemoList')).toContainText('Проверить крепления');expect(db.tables.master_memo_materials).toHaveLength(1);await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=team]').click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();await expect(page.locator('#managerMemoList')).toContainText('Проверить крепления');
});
test('dispatcher report preserves explicit zero payout and resolves staff name',async({page})=>{
 const {db}=await fullStack(page,'dispatcher');Object.assign(db.tables.orders[0],{status:'Выполнена',completed_at:new Date().toISOString(),master_payout:0});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();const report=await page.evaluate(()=>dispatcherReportData('month',new Date()));expect(report.totalPay).toBe(0);expect(report.rows[0].name).toBe('Тестовый мастер');
});
test('memo and claims requests stop on timeout and preserve retry UI',async({page})=>{
 test.setTimeout(35000);await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await page.route('**/api/proxy/master-memo-api',()=>{});await page.route('**/api/proxy/claims-api',()=>{});
 const claimResult=page.evaluate(()=>claimsApi('bootstrap').catch(e=>e.message));
 await page.evaluate(()=>openMasterMemoItem('tips'));await expect(page.locator('#masterMemoItems')).toContainText('Сервер не ответил',{timeout:25000});
 expect(await claimResult).toContain('Сервер не ответил');await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('.modal')).toHaveCount(0);
});
