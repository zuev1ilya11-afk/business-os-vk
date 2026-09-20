const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const localDate=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher v2.4 collects attention items with unique order cards',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].status='В работе';
  db.tables.orders[0].scheduled_date=localDate(-1);
  db.tables.orders[0].reschedule_requested=true;
  db.tables.orders[0].reschedule_reason='Клиент просит вечером';
  db.tables.orders[1].status='В работе';
  db.tables.orders[1].scheduled_date=localDate();
  db.tables.orders[1].master_staff_id=null;
  db.tables.orders[1].master_vk_id=null;
  db.tables.orders[1].master_name='';
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.getByRole('button',{name:/Контроль/})).toBeVisible();
  await page.getByRole('button',{name:/Контроль/}).click();
  await expect(page.locator('.dbV24Control')).toBeVisible();
  await expect(page.locator('.dbV24Card[data-order-id="11"]')).toHaveCount(1);
  await expect(page.locator('.dbV24Card[data-order-id="12"]')).toHaveCount(1);
  await expect(page.locator('.dbV24Card[data-order-id="11"]')).toContainText('Нужно перенести');
  await expect(page.locator('.dbV24Card[data-order-id="11"]')).toContainText('Просрочено');
  await expect(page.locator('.dbV24Card[data-order-id="12"]')).toContainText('Без мастера');
  await page.getByRole('button',{name:/Без мастера ·/}).click();
  await expect(page.locator('.dbV24Card[data-order-id="12"]')).toBeVisible();
  await expect(page.locator('.dbV24Card[data-order-id="11"]')).toHaveCount(0);
});

test('dispatcher v2.4 detects schedule conflicts and can jump to day plan',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  const master=db.tables.orders[0].master_staff_id;
  const masterName=db.tables.orders[0].master_name;
  for(const o of db.tables.orders.slice(0,2)){
    o.status='В работе';
    o.scheduled_date=localDate();
    o.scheduled_time='15:00';
    o.master_staff_id=master;
    o.master_name=masterName;
  }
  await page.goto('/');
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:/Контроль/}).click();
  await page.getByRole('button',{name:/Конфликт времени ·/}).click();
  await expect(page.locator('.dbV24Card')).toHaveCount(2);
  await expect(page.locator('.dbV24Card').first()).toContainText('Конфликт времени');
  await page.locator('.dbV24Card').first().getByRole('button',{name:'План дня'}).click();
  await expect(page.locator('.dbV23Plan')).toBeVisible();
  await expect(page.locator('.dbV23Slot.conflict')).toBeVisible();
});

test('dispatch control v2.4 stays desktop-only',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbV24Control')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Контроль/})).toHaveCount(0);
  await expect(page.locator('#bosOrderSearch')).toBeVisible();
});
