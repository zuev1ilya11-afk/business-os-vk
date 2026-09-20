const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v2.1 moves an order to another day and preserves payout',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  const payout=db.tables.orders[0].master_payout;
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbV21Tools')).toBeVisible();
  await page.locator('.dbOrderCard[data-order-id="11"]').first().click();
  await expect(page.getByText('Быстрый перенос',{exact:true})).toBeVisible();
  const next=localDate(1);
  await page.locator('#dbV21MoveDate').fill(next);
  await page.locator('#dbV21MoveTime').fill('14:00');
  await page.getByRole('button',{name:'Перенести на дату и время'}).click();
  await expect(page.locator('#dispatchBoardDate')).toHaveValue(next);
  expect(db.tables.orders[0].scheduled_date).toBe(next);
  expect(db.tables.orders[0].scheduled_time).toBe('14:00');
  expect(db.tables.orders[0].master_payout).toBe(payout);
});

test('dispatcher v2.1 can auto-assign an unassigned order to a free slot',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[1].scheduled_date=localDate();
  db.tables.orders[1].master_staff_id=null;
  db.tables.orders[1].master_vk_id=null;
  db.tables.orders[1].master_name='';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await page.locator('.dbTray .dbOrderCard[data-order-id="12"]').click();
  await expect(page.getByRole('button',{name:'Назначить свободному мастеру'})).toBeVisible();
  await page.getByRole('button',{name:'Назначить свободному мастеру'}).click();
  await expect(page.locator('.dbTray .dbOrderCard[data-order-id="12"]')).toHaveCount(0);
  expect(db.tables.orders[1].master_staff_id).toBeTruthy();
  expect(db.tables.orders[1].scheduled_date).toBe(localDate());
});

test('dispatcher v2.1 free-master filter and metrics stay desktop-only',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:'Есть свободное окно'})).toBeVisible();
  await expect(page.locator('#dbV21FreeCount')).toContainText('Свободных:');
  await page.getByRole('button',{name:'Есть свободное окно'}).click();
  await expect(page.locator('#dbV21FreeToggle')).toHaveClass(/primary/);

  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbV21Tools')).toHaveCount(0);
  await expect(page.locator('#bosOrderSearch')).toBeVisible();
});
