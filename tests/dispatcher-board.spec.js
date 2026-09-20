const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher assigns an unassigned order from Dispatch Board and preserves approved payout',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[1].scheduled_date=today();
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();

  await expect(page.getByText('Расписание мастеров',{exact:true})).toBeVisible();
  await expect(page.locator('#dispatchBoardDate')).toHaveValue(today());
  await expect(page.locator('.dbTray')).toContainText('Борис');

  await page.evaluate(()=>window.__dispatchBoardMove('12','staff_m','11:00'));
  expect(db.tables.orders[1].master_staff_id).toBe('m');
  expect(db.tables.orders[1].scheduled_date).toBe(today());
  expect(db.tables.orders[1].scheduled_time).toBe('11:00');
  expect(db.tables.orders[1].master_payout).toBe(1105);
  await expect(page.locator('.dbOrderCard[data-order-id="12"]')).toContainText('Борис');
});

test('drag-style move resolves an existing master reschedule request',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{
    scheduled_date:today(),scheduled_time:'10:00',time_slot:'10:00–11:00',
    reschedule_requested:true,reschedule_reason:'Клиент после 15:00',reschedule_requested_at:new Date().toISOString(),reschedule_requested_by:'m'
  });
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:'Перенести заявку'})).toBeVisible();
  await page.evaluate(()=>window.__dispatchBoardMove('11','staff_m','15:00'));

  expect(db.tables.orders[0].scheduled_time).toBe('15:00');
  expect(db.tables.orders[0].reschedule_requested).toBe(false);
  expect(db.tables.orders[0].reschedule_reason).toBeNull();
  expect(db.tables.orders[0].amount).toBe(1000);
  expect(db.tables.orders[0].master_staff_id).toBe('m');
});

test('mobile dispatcher keeps the existing non-board interface',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbBoard')).toHaveCount(0);
  await expect(page.getByText('Заявки',{exact:true})).toBeVisible();
});
