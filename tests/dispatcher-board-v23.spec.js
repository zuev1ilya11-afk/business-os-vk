const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher unified schedule shows masters and half-hour slots without a separate day-plan tab',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[0].time_slot='10:00–12:00';
  db.tables.orders[1].scheduled_date=localDate();
  db.tables.orders[1].master_staff_id=null;
  db.tables.orders[1].master_vk_id=null;
  db.tables.orders[1].master_name='';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187?.version==='187');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:'План дня'})).toBeHidden();
  await expect(page.locator('.du187Root')).toBeVisible();
  await expect(page.locator('.du187Master').first()).toBeVisible();
  await expect(page.locator('.du187Time',{hasText:'10:00'})).toBeVisible();
  await expect(page.locator('.du187Time',{hasText:'10:30'})).toBeVisible();
  await expect(page.locator('.du187Card[data-order-id="11"]')).toBeVisible();
  await expect(page.locator('.du187Card[data-order-id="11"]')).toHaveAttribute('data-duration-slots','4');
});

test('dispatcher unified schedule keeps list mode available',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await page.waitForFunction(()=>window.BOS_UNIFIED_DISPATCH_SCHEDULE_V187?.version==='187');
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root')).toBeVisible();
  await page.getByRole('button',{name:'Список',exact:true}).click();
  await expect(page.locator('.dbV94ListCard').first()).toBeVisible();
  await expect(page.locator('.du187Root')).toHaveCount(0);
  await page.getByRole('button',{name:'Расписание',exact:true}).click();
  await expect(page.locator('.du187Root')).toBeVisible();
});

test('dispatcher unified schedule stays desktop-only',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.du187Root')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'План дня'})).toHaveCount(0);
  await expect(page.locator('#bosOrderSearch')).toBeVisible();
});
