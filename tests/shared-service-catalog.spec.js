const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('dispatcher selects catalog work and saves its existing name and base price',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>openOrderForm());
  const form=page.locator('#orderForm');
  await expect(form.locator('#bosService')).toHaveValue('');
  await expect(form.locator('[name=original_amount]')).toHaveValue('');
  await form.locator('[name=client]').fill('Клиент каталога');
  await form.locator('#bosPhone').fill('9991234567');
  await form.locator('[name=address]').fill('Адрес каталога');
  await form.locator('#bosService').selectOption('4');
  await expect(form.locator('#bosServiceInfo')).toContainText('комплект');
  await expect(form.locator('[name=original_amount]')).toHaveValue('1699');
  await form.locator('[name=comment]').fill('Нестандартное крепление согласовать');
  await form.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(form).toHaveCount(0);
  const saved=db.tables.orders.find(o=>o.client==='Клиент каталога');
  expect(saved.work).toBe('Установка декоративного карниза длиной до 2,5 метров');
  expect(saved.amount).toBe(1699);
  expect(saved.comment).toBe('Нестандартное крепление согласовать');
  await page.evaluate(id=>openOrder(id),saved.id);
  await expect(page.locator('#modalRoot')).toContainText(saved.work);
});

test('editing a legacy order preserves work outside the catalog and its amount',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{work:'Старая нестандартная работа',phone:'+79991234567',comment:'Старый комментарий'});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.evaluate(()=>openOrderForm('11'));
  const form=page.locator('#orderForm');
  await expect(form.locator('#bosService')).toHaveValue('legacy');
  await expect(form.locator('#bosService option:checked')).toContainText('Старая нестандартная работа');
  await expect(form.locator('[name=original_amount]')).toHaveValue('1000');
  await form.locator('[name=comment]').fill('Уточнённый комментарий');
  await form.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(form).toHaveCount(0);
  expect(db.tables.orders[0].work).toBe('Старая нестандартная работа');
  expect(db.tables.orders[0].amount).toBe(1000);
});

test('master browses the shared catalog and searches additional work on a narrow screen',async({page})=>{
  await fullStack(page,'master');
  await page.setViewportSize({width:320,height:700});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=team]').click();
  await page.getByRole('button',{name:/Прайс услуг/}).click();
  const rows=page.locator('.bosCatalogRow');
  const catalog=await page.evaluate(()=>window.BOS_SERVICE_CATALOG);
  await expect(rows).toHaveCount(catalog.length);
  await expect(rows.nth(4)).toContainText(catalog[4].n);
  await expect(rows.nth(4)).toContainText('1 699');
  await expect(rows.nth(4)).toContainText('за комплект');
  await page.locator('#bosCatalogSearch').fill('дополнительной точки');
  await expect(page.locator('.bosCatalogRow:visible')).toHaveCount(1);
  await expect(page.locator('.bosCatalogRow:visible')).toContainText('Дополнительная работа');
  await page.locator('#bosCatalogSearch').fill('несуществующаяработа');
  await expect(page.locator('#bosCatalogEmpty')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});


test('price materials show loading, safe error, retry and empty states while catalog stays usable',async({page})=>{
  await fullStack(page,'master');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=team]').click();
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  let attempts=0;
  await page.route('**/api/proxy/master-memo-api',async route=>{
    attempts++;
    if(attempts===1){
      await pending;
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'STACK_TRACE_INTERNAL_DATABASE_FAILURE'})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,items:[]})});
  });
  await page.getByRole('button',{name:/Прайс услуг/}).click();
  await page.locator('.bosPriceMaterials summary').click();
  await expect(page.locator('#bosMasterPrice')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('#bosMasterPrice [role=status]')).toBeVisible();
  await page.locator('#bosCatalogSearch').fill('карниз');
  await expect(page.locator('.bosCatalogRow:visible').first()).toBeVisible();
  release();
  await expect(page.locator('#bosMasterPrice [role=alert]')).toContainText('Проверьте соединение');
  await expect(page.locator('#modalRoot')).not.toContainText('STACK_TRACE');
  await expect(page.locator('#bosMasterPrice')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await page.locator('.bosPriceMaterials summary').click();
  await expect(page.locator('#bosMasterPrice')).toContainText('Материалы руководителя пока не добавлены');
  await expect(page.locator('#bosMasterPrice')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.bosCatalogRow').first()).toBeVisible();
  expect(attempts).toBe(2);
});
