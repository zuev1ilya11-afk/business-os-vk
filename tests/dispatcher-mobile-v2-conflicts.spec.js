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
    Object.assign(a,{master_staff_id:masterId,master_name:'Тестовый мастер',scheduled_date:'2099-09-10',scheduled_time:'10:00'});
    Object.assign(b,{master_staff_id:masterId,master_name:'Тестовый мастер',scheduled_date:'2099-09-10',scheduled_time:'10:30'});
    state.orders.push({id:'13',client:'Без конфликта',address:'Третий адрес',work:'Монтаж',status:'В работе',scheduled_date:'2099-09-10',scheduled_time:'14:00'});
    show('orders');
    setTimeout(()=>window.BOS_DISPATCHER_CONFLICTS.refresh(),0);
  },master.id);

  await expect(page.locator('.dmConflictBar')).toBeVisible();
  await expect(page.locator('.dmConflictBar')).toContainText('2');
  await expect(page.locator('.dmConflictBadge')).toHaveCount(2);
  await expect(page.locator('.dmConflictOrder')).toHaveCount(2);
  await expect(page.locator('.opsCompactOrder')).toHaveCount(3);

  await page.getByRole('button',{name:'Показать конфликты времени'}).click();
  await expect(page.locator('.opsCompactOrder:visible')).toHaveCount(2);
  await expect(page.locator('.opsCompactOrder:visible')).not.toContainText('Без конфликта');

  await page.locator('.dmShortcuts button').filter({hasText:'Все'}).click();
  await expect(page.locator('.opsCompactOrder:visible')).toHaveCount(3);
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
