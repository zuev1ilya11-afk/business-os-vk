const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('mobile dispatcher highlights overlapping orders for the same master and filters them',async({page})=>{
  const {master}=await fullStack(page,'dispatcher');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.bosDispatcherMobile')).toBeVisible();

  await page.evaluate(masterId=>{
    const a=state.orders.find(o=>String(o.id)==='11');
    const b=state.orders.find(o=>String(o.id)==='12');
    Object.assign(a,{master_staff_id:masterId,master_name:'Тестовый мастер',scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00'});
    Object.assign(b,{master_staff_id:masterId,master_name:'Тестовый мастер',scheduled_date:'2099-09-10',scheduled_time:'10:30',time_slot:'10:30–11:30'});
    state.orders.push({id:'13',client:'Без конфликта',address:'Третий адрес',work:'Монтаж',status:'В работе',scheduled_date:'2099-09-10',scheduled_time:'14:00',time_slot:'14:00–15:00'});
    show('orders');
  },master.id);

  // The mobile dispatcher opens on the "Сегодня" shortcut. This regression
  // uses a fixed future date intentionally, so select "Все" before checking
  // conflict decoration instead of depending on the default day filter.
  await page.locator('.dmShortcuts button').filter({hasText:'Все'}).click();
  await page.evaluate(()=>window.BOS_DISPATCHER_CONFLICTS.refresh());

  await expect(page.locator('.dmConflictBar')).toBeVisible();
  await expect(page.locator('.dmConflictBar')).toContainText('2');
  await expect(page.locator('.dmConflictBadge')).toHaveCount(2);
  await expect(page.locator('.dmConflictOrder')).toHaveCount(2);
  await expect(page.locator('.opsCompactOrder')).toHaveCount(3);

  await page.getByRole('button',{name:'Показать конфликты времени'}).click();
  await expect(page.locator('.opsCompactOrder:visible')).toHaveCount(2);
  await expect(page.locator('.opsCompactOrder:visible').filter({hasText:'Без конфликта'})).toHaveCount(0);

  await page.locator('.dmShortcuts button').filter({hasText:'Все'}).click();
  await expect(page.locator('.opsCompactOrder:visible')).toHaveCount(3);
  await expect(page.locator('.opsCompactOrder:visible').filter({hasText:'Без конфликта'})).toHaveCount(1);
});

test('conflict decoration stays mobile dispatcher only',async({page})=>{
  await fullStack(page,'owner');
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('.dmConflictBar')).toHaveCount(0);
  await expect(page.locator('.dmConflictBadge')).toHaveCount(0);
});
