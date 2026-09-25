const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master order shows Yandex route button for client address',async({page})=>{
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders[0];
  Object.assign(order,{
    id:'11',
    status:'В работе',
    address:'Невский проспект, 28',
    city:'Санкт-Петербург',
    master_workflow_stage:'assigned'
  });

  await page.setViewportSize({width:390,height:844});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_MASTER_ORDER_FOCUS_V126===true);
  await page.locator('nav button[data-page="orders"]').click();

  const card=page.locator('.masterV125Card[data-master-order-id="11"]');
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Открыть заявку',exact:true}).click();

  const route=page.locator('.masterV149Route');
  await expect(route).toBeVisible();
  await expect(route).toContainText('Построить маршрут в Яндекс Картах');
  const href=await route.getAttribute('href');
  expect(href).toContain('https://yandex.ru/maps/?mode=routes');
  expect(href).toContain('rtt=auto');
  expect(decodeURIComponent(href)).toContain('Санкт-Петербург, Невский проспект, 28');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
