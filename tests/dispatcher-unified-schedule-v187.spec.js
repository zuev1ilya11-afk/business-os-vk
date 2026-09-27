const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v187 unifies schedule and day plan and keeps multi-slot duration when moved',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{
    scheduled_date:localDate(),
    scheduled_time:'10:00',
    time_slot:'10:00–12:00',
    status:'В работе'
  });

  await page.setViewportSize({width:1360,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187?.version==='187');
  await page.locator('nav [data-page=orders]').click();

  await expect(page.locator('.du187Root')).toBeVisible();
  await expect(page.locator('.dbV23Tab')).toBeHidden();
  await expect(page.locator('.du187Time',{hasText:'10:00'})).toBeVisible();
  await expect(page.locator('.du187Time',{hasText:'10:30'})).toBeVisible();

  const card=page.locator('.du187Card[data-order-id="11"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-duration-slots','4');
  await expect(card.locator('.du187When')).toHaveText('10:00–12:00');

  expect(await page.evaluate(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187.setDuration('11',6))).toBe(true);
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('10:00–13:00');
  await expect(page.locator('.du187Card[data-order-id="11"]')).toHaveAttribute('data-duration-slots','6');

  expect(await page.evaluate(masterVk=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187.move('11',masterVk,'11:30'),master.external_id)).toBe(true);
  await expect.poll(()=>db.tables.orders[0].scheduled_time).toBe('11:30');
  await expect.poll(()=>db.tables.orders[0].time_slot).toBe('11:30–14:30');
  await expect(page.locator('.du187Card[data-order-id="11"] .du187When')).toHaveText('11:30–14:30');
});
