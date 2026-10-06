const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

// The fixture uses Moscow calendar days; the browser must use that same day.
// Keep failed CI interactions, DOM snapshots and mocked API exchanges reviewable.
test.use({trace:'retain-on-failure',timezoneId:'Europe/Moscow'});

const moscowDate=(offset=0)=>{const d=new Date(Date.now()+offset*24*60*60*1000);const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(({type})=>type!=='literal').map(({type,value})=>[type,value]));return `${parts.year}-${parts.month}-${parts.day}`};

test('dispatcher v2.1 moves an order to another day and preserves payout',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=moscowDate();
  db.tables.orders[0].scheduled_time='10:00';
  const payout=db.tables.orders[0].master_payout;
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbV21Tools')).toBeVisible();
  await page.locator('.du187Card[data-order-id="11"]').click();
  await expect(page.getByText('Быстрый перенос',{exact:true})).toBeVisible();
  const next=moscowDate(1);
  const saved=page.waitForResponse(response=>{
    if(!response.url().includes('/mini-app-api'))return false;
    const body=response.request().postDataJSON();
    return body?.action==='updateOrder'&&String(body.id)==='11';
  });
  // Background bootstrap can rerender the mocked detail panel between separate
  // Playwright fills. Set both values and activate the existing button in one
  // browser task so this test validates the move request instead of that race.
  await page.locator('.dbV21QuickMove').evaluate((box,{date,time})=>{
    const dateInput=box.querySelector('#dbV21MoveDate');
    const timeInput=box.querySelector('#dbV21MoveTime');
    const button=box.querySelector('button');
    if(!dateInput||!timeInput||!button)throw new Error('Quick move controls are missing');
    dateInput.value=date;
    timeInput.value=time;
    button.click();
  },{date:next,time:'14:00'});
  const response=await saved;
  expect(response.request().postDataJSON()).toMatchObject({scheduled_date:next,scheduled_time:'14:00'});
  expect(await response.json()).toMatchObject({ok:true,order:{scheduled_date:next,scheduled_time:'14:00'}});
  await expect(page.locator('#dispatchBoardDate')).toHaveValue(next);
  expect(db.tables.orders[0].scheduled_date).toBe(next);
  expect(db.tables.orders[0].scheduled_time).toBe('14:00');
  expect(db.tables.orders[0].master_payout).toBe(payout);
});

test('dispatcher v2.1 can auto-assign an unassigned order to a free slot',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[1].scheduled_date=moscowDate();
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
  expect(db.tables.orders[1].scheduled_date).toBe(moscowDate());
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
