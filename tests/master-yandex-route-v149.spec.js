const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('master order client address is clickable and opens exact address in Yandex Maps',async({page})=>{
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

  const address=page.locator('.bosHandsAddressLink');
  await expect(address).toBeVisible();
  await expect(address).toHaveText('Невский проспект, 28');
  const href=await address.getAttribute('href');
  expect(href).toContain('https://yandex.ru/maps/?text=');
  expect(decodeURIComponent(href)).toContain('Санкт-Петербург, Невский проспект, 28');
  await expect(page.locator('.masterV149Route')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
