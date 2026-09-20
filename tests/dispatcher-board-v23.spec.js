const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v2.3 shows vertical day plan with masters and half-hour slots',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=localDate();
  db.tables.orders[0].scheduled_time='10:00';
  db.tables.orders[1].scheduled_date=localDate();
  db.tables.orders[1].master_staff_id=null;
  db.tables.orders[1].master_vk_id=null;
  db.tables.orders[1].master_name='';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:'План дня'})).toBeVisible();
  await page.getByRole('button',{name:'План дня'}).click();
  await expect(page.locator('.dbV23Plan')).toBeVisible();
  await expect(page.locator('.dbV23MasterHead').first()).toBeVisible();
  await expect(page.locator('.dbV23Time')).toHaveCount(24);
  await expect(page.locator('.dbV23QueueCard[data-order-id="12"]')).toBeVisible();
  await expect(page.locator('.dbV23Card[data-order-id="11"]').first()).toBeVisible();
});

test('dispatcher v2.3 keeps legacy schedule available',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'План дня'}).click();
  await expect(page.locator('.dbV23Plan')).toBeVisible();
  await page.getByRole('button',{name:'Расписание',exact:true}).click();
  await expect(page.locator('.dbTimeline')).toBeVisible();
  await expect(page.locator('.dbV23Plan')).toHaveCount(0);
});

test('dispatcher v2.3 stays desktop-only',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbV23Plan')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'План дня'})).toHaveCount(0);
  await expect(page.locator('#bosOrderSearch')).toBeVisible();
});
