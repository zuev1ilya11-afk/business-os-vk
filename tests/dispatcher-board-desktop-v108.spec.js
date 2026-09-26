const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('dispatcher list defaults to newest orders first',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'Список',exact:true}).click();

  await expect(page.locator('#bosOrderSort')).toHaveValue('newest');
  await expect(page.locator('.dbV94ListCard').first()).toHaveAttribute('data-order-id','12');
});

test('completed orders stay visible on the dispatcher schedule',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{status:'Выполнена',scheduled_date:today(),scheduled_time:'10:00',time_slot:'10:00–11:00'});

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();

  const done=page.locator('.dbTimeline .dbOrderCard[data-order-id="11"]');
  await expect(done).toBeVisible();
  await expect(done).toHaveClass(/done/);
  await expect(done).toContainText('Анна');
});

test('dispatcher schedule fits its hours without an internal horizontal scrollbar',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.orders[0].scheduled_date=today();
  db.tables.orders[0].scheduled_time='10:00';

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbTimeline')).toBeVisible();

  const geometry=await page.locator('.dbTimelineWrap').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,overflow:getComputedStyle(el).overflowX}));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+2);
  expect(geometry.overflow).toBe('visible');
});

test('left attention area accepts a dragged assigned order',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'10:00',time_slot:'10:00–11:00'});

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();

  const card=page.locator('.dbTimeline .dbOrderCard[data-order-id="11"]');
  await expect(card).toBeVisible();
  await card.dragTo(page.locator('.dbAttention'));
  await expect.poll(()=>db.tables.orders[0].master_staff_id).toBeNull();
  await expect(page.locator('.dbTray .dbOrderCard[data-order-id="11"]')).toBeVisible();
});
