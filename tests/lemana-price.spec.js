const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
async function open(page,id){await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>window.BOS_LOAD_ROLE_MODULES(state.user.role));await page.waitForFunction(()=>String(openOrderForm).includes('enhanceNewOrderForm'));await page.evaluate(id=>openOrderForm(id),id);return page.locator('#orderForm');}
test('Lemana order gets new prices, quantities and a separate explicit order total',async({page})=>{
 const {db}=await fullStack(page,'owner');const f=await open(page);
 await f.locator('[name=source]').selectOption('Лемана Про');
 await expect(f.locator('#bosService option[data-service-id^="lemana_"]')).toHaveCount(39);
 const value=await f.locator('option[data-service-id="lemana_20261111_010"]').getAttribute('value');await f.locator('#bosService').selectOption(value);
 await expect(f.locator('.bosWorkPrice')).toHaveValue('1850');await f.locator('.bosWorkQty').fill('2');await expect(f.locator('.bosWorkLineTotal')).toContainText('3 700');
 await expect(f.locator('[name=original_amount]')).toHaveValue('');await f.getByRole('button',{name:'Использовать сумму позиций'}).click();await expect(f.locator('[name=original_amount]')).toHaveValue('3700');
 await f.locator('[name=client]').fill('Проверка прайса');await f.locator('[name=address]').fill('Тестовый адрес');await f.locator('#bosPhone').fill('9991234567');await f.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(f).toHaveCount(0);
 const saved=db.tables.orders.find(o=>o.client==='Проверка прайса');expect(saved.work_items[0]).toMatchObject({service_id:'lemana_20261111_010',quantity:2,unit_price:1850,amount:3700});expect(saved.amount).toBe(3700);
});
test('switching source preserves selected work and entered prices but refreshes available services',async({page})=>{
 await fullStack(page,'owner');const f=await open(page);await f.locator('#bosService').selectOption('4');await f.locator('.bosWorkQty').fill('2');await f.locator('.bosWorkPrice').fill('1700');
 await f.locator('[name=source]').selectOption('Лемана Про');await expect(f.locator('#bosService')).toHaveValue('legacy');await expect(f.locator('.bosWorkPrice')).toHaveValue('1700');await expect(f.locator('.bosWorkQty')).toHaveValue('2');
 await f.locator('#bosAddWork').click();await expect(f.locator('.bosWorkSelect').last().locator('option[data-service-id^="lemana_"]')).toHaveCount(39);
 await f.locator('[name=source]').selectOption('Руки');await expect(f.locator('.bosWorkSelect').last().locator('option[data-service-id^="standard_"]')).toHaveCount(34);await expect(f.locator('.bosWorkPrice').first()).toHaveValue('1700');
});
test('editing an existing Lemana order keeps its saved quantities, price and payouts',async({page})=>{
 const {db}=await fullStack(page,'owner');Object.assign(db.tables.orders[0],{source:'Лемана Про',phone:'+79991234567',work:'Старый карниз × 2 комплект',work_items:[{name:'Старый карниз',service_id:'standard_005',quantity:2,unit:'комплект',unit_price:1699,amount:3398}],amount:3398,original_amount:3398,master_payout:1877.4});
 const old=structuredClone(db.tables.orders[0]),f=await open(page,'11');await expect(f.locator('.bosWorkPrice')).toHaveValue('1699');await f.locator('[name=comment]').fill('Уточнение');await f.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await expect(f).toHaveCount(0);
 for(const k of ['amount','original_amount','master_payout','work_items'])expect(db.tables.orders[0][k]).toEqual(old[k]);
});
test('master sees all 40 prices with conditions and searchable height charges on mobile',async({page})=>{
 await fullStack(page,'master');await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.locator('nav [data-page=team]').click();await page.getByRole('button',{name:/Памятки и прайс/}).click();await page.getByRole('button',{name:/Прайс услуг/}).click();
 await page.locator('[data-price-tab=lemana]').click();await expect(page.locator('.bosLemanaRow')).toHaveCount(40);await expect(page.locator('.bosLemanaCatalog')).toContainText('2 800');await page.locator('#bosLemanaPriceSearch').fill('Доплата за работы на высоте');await expect(page.locator('.bosLemanaRow:visible')).toHaveCount(1);await expect(page.locator('.bosLemanaRow:visible')).toContainText('550');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:'test-results/lemana-price-mobile.png',fullPage:true});
 await page.locator('[data-price-tab=catalog]').click();await expect(page.locator('.bosLemanaCatalog')).toBeHidden();
});
