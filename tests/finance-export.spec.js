const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const {unzipSync,strFromU8}=require('fflate');
const fs=require('node:fs');
async function ready(page,role='owner'){
 await page.clock.install({time:new Date('2026-10-11T09:00:00Z')});
 const ctx=await fullStack(page,role);Object.assign(ctx.db.tables.orders[0],{status:'Выполнена',completed_at:'2026-10-11T08:00:00Z',source:'Авито',master_payout:600,extra_work_amount:100,city:'СПб'});
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 if(role==='owner'||role==='manager')await page.locator('nav [data-page="finance"]').click();
 return ctx;
}
for(const role of ['owner','manager'])test(`${role} downloads a real six/five-sheet XLSX, repeats it and fits mobile`,async({page},info)=>{
 await ready(page,role);const button=page.getByRole('button',{name:'Скачать детализацию',exact:true});await expect(button).toBeEnabled();
 for(const width of [320,390,768]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
 for(let n=0;n<2;n++){
  await button.click();const dialog=page.locator('[data-fin-export-dialog]');await expect(dialog).toContainText('01.10.2026–31.10.2026');await expect(dialog).toContainText('Заявок: 1');
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Скачать Excel'}).click();const file=await download;
  expect(file.suggestedFilename()).toBe('business-os-finance-2026-10-01_2026-10-31.xlsx');
  const path=info.outputPath(`finance-${role}-${n}.xlsx`);await file.saveAs(path);const entries=unzipSync(fs.readFileSync(path));
  expect(strFromU8(entries['xl/workbook.xml'])).toContain('Заявки');expect(strFromU8(entries['xl/worksheets/sheet2.xml'])).toContain('<v>700</v>');
  await page.locator('.modalClose').click();await expect(button).toBeEnabled();
 }
 await page.screenshot({path:info.outputPath('finance-export-mobile.png'),fullPage:true});
});
test('source/master/work filters reach the server; no data never downloads an empty file',async({page})=>{
 const {master}=await ready(page);await page.locator('.finFilters').evaluate(n=>n.open=true);
 await page.locator('[data-fin-filter="master"]').selectOption(master.id);await page.locator('[data-fin-filter="source"]').selectOption('Авито');
 await page.getByRole('button',{name:'Скачать детализацию',exact:true}).click();await expect(page.locator('[data-fin-export-dialog]')).toContainText('Заявок: 1');await page.locator('.modalClose').click();
 await page.locator('.finPeriodControl').evaluate(n=>n.open=true);await page.locator('[data-fin-period="yesterday"]').click();
 await page.getByRole('button',{name:'Скачать детализацию',exact:true}).click();await expect(page.locator('[data-fin-export-dialog]')).toContainText('За выбранный период данных для выгрузки нет');await expect(page.getByRole('button',{name:'Скачать Excel'})).toHaveCount(0);
});
test('selected master downloads a compact shareable statement on mobile',async({page},info)=>{
 const {master}=await ready(page);await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('button',{name:'Скачать для мастера',exact:true})).toHaveCount(0);
 await page.locator('.finFilters').evaluate(n=>n.open=true);
 await page.locator('[data-fin-filter="master"]').selectOption(master.id);
 await page.getByRole('button',{name:'Скачать для мастера',exact:true}).click();
 const dialog=page.locator('[data-fin-export-dialog]');await expect(dialog).toContainText('Один лист');
 await expect(dialog).toContainText('Начислено:');await expect(dialog).not.toContainText('Расходных операций');
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Скачать Excel'}).click();const file=await pending;
 expect(file.suggestedFilename()).toMatch(/^business-os-master-/);
 const out=info.outputPath('master-statement.xlsx');await file.saveAs(out);const entries=unzipSync(fs.readFileSync(out));
 expect(Object.keys(entries).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k))).toHaveLength(1);
 expect(strFromU8(entries['xl/worksheets/sheet1.xml'])).toContain('<v>700</v>');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('master-statement-mobile.png'),fullPage:true});
});
test('stale totals and late database failures are safe and release the download button',async({page})=>{
 const {db}=await ready(page);await expect(page.getByRole('button',{name:'Скачать детализацию',exact:true})).toBeEnabled();
 db.tables.orders[0].amount=2222;
 await page.getByRole('button',{name:'Скачать детализацию',exact:true}).click();await expect(page.locator('[data-fin-export-dialog]')).toContainText('Данные изменились');await page.locator('.modalClose').click();
 db.beforeQuery=(table)=>{if(table==='orders')throw Error('secret SQL internal-url')};
 await page.getByRole('button',{name:'Скачать детализацию',exact:true}).click();await expect(page.locator('[data-fin-export-dialog]')).toContainText('Не удалось сформировать финансовую детализацию');await expect(page.locator('[data-fin-export-dialog]')).not.toContainText('secret');
});
test('double clicks produce one preview and logout cancels the pending request',async({page})=>{
 await ready(page);let calls=0,release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/*mini-app-api',async route=>{if(route.request().postDataJSON()?.action==='previewFinanceExport'){calls++;await gate;}await route.fallback()});
 const button=page.getByRole('button',{name:'Скачать детализацию',exact:true});await expect(button).toBeEnabled();
 await button.evaluate(b=>{b.click();b.click()});await expect(button).toBeDisabled();await expect.poll(()=>calls).toBe(1);
 await page.evaluate(()=>{localStorage.setItem('bos_manual_logout_v1','1');window.dispatchEvent(new StorageEvent('storage',{key:'bos_manual_logout_v1'}))});release();
 await expect(page.locator('[data-fin-export-dialog]')).toHaveCount(0);await expect(page.locator('#financePage')).toHaveCount(0);
});
for(const role of ['master','dispatcher'])test(`${role} cannot reach the finance export control`,async({page})=>{
 await ready(page,role);await page.evaluate(()=>{location.hash='finance'});await expect(page.getByRole('button',{name:'Скачать детализацию',exact:true})).toHaveCount(0);
});
