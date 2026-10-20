const {chromium,expect}=require('@playwright/test');const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'<-loopback>'}});
 try{
 const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});
 await page.goto('file://'+path.resolve('docs/lemana/preview.html'));await expect(page.locator('#authGate')).toBeHidden();
 await page.getByRole('button',{name:'Форма с количеством',exact:true}).click();const f=page.locator('#orderForm');
 await f.locator('[name=client]').fill('Синтетический клиент количества');await f.locator('#bosPhone').fill('9990000004');await f.locator('[name=address]').fill('Тестовый адрес');
 await f.locator('#bosService').selectOption('4');await f.locator('.bosWorkQty').fill('2');await f.locator('.bosWorkPrice').fill('500');
 await f.locator('#bosAddWork').click();await f.locator('.bosWorkSelect').last().selectOption('custom');await f.locator('.bosCustomWork').last().fill('Тестовая работа по длине');await f.locator('.bosWorkUnit').last().selectOption('м');await f.locator('.bosWorkQty').last().fill('1,5');await f.locator('.bosWorkPrice').last().fill('100');
 await f.getByRole('button',{name:'Использовать сумму позиций'}).click();await expect(f.locator('[name=original_amount]')).toHaveValue('1150');
 await f.locator('#bosWorkStack').scrollIntoViewIfNeeded();await page.screenshot({path:'docs/lemana/quantity-mobile.png'});
 expect(await f.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await f.locator('[type=submit]').click();await expect(f).toHaveCount(0);
 const created=await page.evaluate(()=>state.orders.find(o=>o.client==='Синтетический клиент количества'));expect(created.work_items.map(x=>x.quantity)).toEqual([2,1.5]);
 await page.evaluate(id=>openOrderForm(id),created.id);await expect(f.locator('.bosWorkQty').last()).toHaveValue('1,5');await page.evaluate(()=>closeModal());
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать тестовый XLSX'}).click();const file=await download;const filePath=await file.path();
 await page.getByRole('button',{name:'Импорт',exact:true}).click();const box=page.locator('.lemanaImport');
 await box.locator('#lemanaFile').setInputFiles({name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:require('node:fs').readFileSync(filePath)});
 await box.locator('#lemanaTimezone').selectOption('Europe/Moscow');await box.locator('#lemanaCheck').click();await expect(box).toContainText('Заявки ещё не созданы');
 const before=await page.evaluate(()=>state.orders.length);expect(before).toBe(3);
 expect(await box.locator('[data-import-row]:enabled').count()).toBe(1);
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'docs/lemana/import-preview.png'});
 await box.locator('[data-import-row]:enabled').check();await box.locator('#lemanaConfirm').click();await expect(box).toContainText('Импорт завершён');
 const imported=await page.evaluate(()=>state.orders.find(o=>o.order_number==='NEW-0042'));expect(imported.master_vk_id).toBe('staff_m');
 await page.evaluate(id=>openOrderForm(id),imported.id);await expect(f.locator('[name=master_vk_id]')).toHaveValue('staff_m');await expect(f.locator('[name=status]')).toHaveValue('Назначена');await expect(f.locator('[name=time_slot]')).toHaveValue('12:30');
 await f.locator('[type=submit]').click();await expect(f).toHaveCount(0);
 expect(await page.evaluate(()=>state.orders.find(o=>o.order_number==='NEW-0042').master_payout)).toBe(552.5);
 expect(errors).toEqual([]);expect(external).toEqual([]);
 console.log('PASS: portable actual UI, quantities, explicit import, immediate edit, no external requests');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
