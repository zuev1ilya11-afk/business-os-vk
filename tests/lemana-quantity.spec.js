const {test,expect}=require('@playwright/test');const {fullStack}=require('./helpers/full-stack.cjs');
test('catalog and custom quantity persist; manual total is explicit; edit keeps the source',async({page})=>{
 const {db}=await fullStack(page,'owner');await page.setViewportSize({width:360,height:850});await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>window.BOS_LOAD_ROLE_MODULES(state.user.role));await page.waitForFunction(()=>String(openOrderForm).includes('enhanceNewOrderForm'));await page.evaluate(()=>openOrderForm());const f=page.locator('#orderForm');
 await f.locator('[name=client]').fill('Синтетический клиент');await f.locator('#bosPhone').fill('9991234567');await f.locator('[name=address]').fill('Тестовый адрес');await f.locator('[name=source]').selectOption('Лемана Про');
 await f.locator('#bosService').selectOption('4');await f.locator('.bosWorkQty').fill('2');await f.locator('.bosWorkPrice').fill('500');
 await expect(f.locator('.bosWorkLineTotal')).toContainText('1');await expect(f.locator('[name=original_amount]')).toHaveValue('');
 await f.locator('#bosAddWork').click();await f.locator('.bosWorkSelect').last().selectOption('custom');await f.locator('.bosCustomWork').last().fill('Тест длины');await f.locator('.bosWorkUnit').last().selectOption('м');await f.locator('.bosWorkQty').last().fill('1,5');await f.locator('.bosWorkPrice').last().fill('100');await f.getByRole('button',{name:'Использовать сумму позиций'}).click();await expect(f.locator('[name=original_amount]')).toHaveValue('1150');
 await f.getByRole('button',{name:'Создать заявку',exact:true}).click();await expect(f).toHaveCount(0);const row=db.tables.orders.find(x=>x.client==='Синтетический клиент');expect(row.work_items.map(x=>x.quantity)).toEqual([2,1.5]);expect(row.amount).toBe(1150);await page.reload();await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(id=>openOrderForm(id),row.id);await expect(f.locator('[name=source]')).toHaveValue('Лемана Про');await expect(f.locator('.bosWorkQty').first()).toHaveValue('2');await expect(f.locator('.bosWorkQty').last()).toHaveValue('1,5');
 expect(await f.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('untouched legacy source, imported status and precise scheduled time survive edit',async({page})=>{
 const {db}=await fullStack(page,'owner');
 Object.assign(db.tables.orders[0],{phone:'+79990000001',source:null,scheduled_time:'12:30:24',status:'Назначена'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await page.evaluate(()=>window.BOS_LOAD_ROLE_MODULES(state.user.role));await page.waitForFunction(()=>String(openOrderForm).includes('enhanceNewOrderForm'));await page.evaluate(()=>openOrderForm('11'));
 const f=page.locator('#orderForm');await expect(f.locator('[name=source]')).toHaveValue('');await expect(f.locator('[name=status]')).toHaveValue('Назначена');await expect(f.locator('[name=time_slot]')).toHaveValue('12:30');
 await f.locator('[type=submit]').click();await expect(f).toHaveCount(0);
 expect(db.tables.orders[0]).toMatchObject({phone:'+79990000001',source:null,scheduled_time:'12:30:24',status:'Назначена',master_payout:552.5});
});
