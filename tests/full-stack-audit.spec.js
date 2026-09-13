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
 await expect(page.locator('#orderForm')).toHaveCount(0);expect(db.tables.orders).toHaveLength(3);const order=db.tables.orders.find(x=>x.client==='Заказ аудита');expect(order.master_staff_id).toBe('m');expect(order.master_payout).toBe(297.5);
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=orders]').click();await page.locator('#bosOrderSearch').fill('Заказ аудита');await expect(page.locator('.bosFilteredOrder')).toHaveCount(1);await expect(page.locator('.bosFilteredOrder')).toContainText('Тестовый мастер');
});
test('owner settings and team modals open and close without page errors',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await fullStack(page);await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.getByRole('button',{name:'Инструменты владельца'}).click();await expect(page.locator('.modal')).toBeVisible();await page.locator('.modalClose').click();await expect(page.locator('.modal')).toHaveCount(0);await page.locator('nav [data-page=team]').click();await page.getByRole('button',{name:'Логины и пароли'}).click();await expect(page.locator('.modal')).toContainText('Тестовый мастер');await page.getByRole('button',{name:'Закрыть',exact:true}).click();expect(errors).toEqual([]);
});
test('master calendar presets save and reload through actual handler',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const {db}=await fullStack(page,'master');await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=dispatch]').click();await page.getByLabel('Все дни',{exact:true}).check();await expect(page.locator('.bosCalDay:not(.working)')).toHaveCount(0);await page.getByRole('button',{name:'Сохранить график'}).click();await expect.poll(()=>db.tables.staff_schedule.filter(x=>x.is_working).length).toBeGreaterThan(27);await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=dispatch]').click();await expect(page.locator('.bosCalDay:not(.working)')).toHaveCount(0);await page.getByRole('button',{name:'Этот месяц'}).click();expect(errors).toEqual([]);
});
