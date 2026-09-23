const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

function dateOffset(days){
  const d=new Date();
  d.setDate(d.getDate()+days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

test('dispatcher orders v3 adds tomorrow, city, status and quick status action',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{scheduled_date:dateOffset(1),city:'Санкт-Петербург',status:'В работе'});
  Object.assign(db.tables.orders[1],{scheduled_date:dateOffset(0),city:'Москва',status:'В работе'});

  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_ORDERS_V3===true);

  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('#dmv3City')).toBeVisible();
  await expect(page.locator('#dmv3Status')).toBeVisible();
  await expect(page.locator('.dmv3TomorrowShortcut')).toBeVisible();

  await page.locator('.dmv3TomorrowShortcut').click();
  await expect(page.locator('#bosOrderList .opsCompactOrder:visible')).toHaveCount(1);
  await expect(page.locator('#bosOrderList .opsCompactOrder:visible')).toContainText('Анна');

  await page.locator('#dmv3City').selectOption({label:'Санкт-Петербург'});
  await page.locator('#dmv3Status').selectOption({label:'В работе'});
  await expect(page.locator('#bosOrderList .opsCompactOrder:visible')).toHaveCount(1);
  await expect(page.locator('#content h2 + .muted')).toHaveText('Найдено: 1');

  const card=page.locator('#bosOrderList .opsCompactOrder:visible').first();
  await expect(card.getByRole('button',{name:'Изменить статус заявки'})).toBeVisible();
  await card.getByRole('button',{name:'Изменить статус заявки'}).click();
  const status=page.locator('#quickStatus');
  await expect(status).toBeVisible();
  await expect(status).toBeFocused();
  await expect(status.locator('option[value="Выполнена"]')).toBeDisabled();
});
