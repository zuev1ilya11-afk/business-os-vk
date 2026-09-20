const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('smart dispatcher recommends the best contextual master and assigns only after confirmation',async({page})=>{
  await page.setViewportSize({width:1600,height:950});
  const {db}=await fullStack(page,'dispatcher');
  db.tables.business_staff.push({id:'m2',external_id:'staff_m2',full_name:'Другой мастер',role:'master',is_active:true,phone:'+79990000002',login:'m2',password_hash:'audit-password',city:'Москва'});
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});

  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await page.locator('.dbOrderCard[data-order-id="12"]').first().click();

  await expect(page.locator('.dbSmartAssign')).toBeVisible();
  const best=page.locator('.dbSmartCandidate').first();
  await expect(best).toContainText('Тестовый мастер');
  await expect(best).toContainText('город совпадает');

  page.once('dialog',dialog=>dialog.accept());
  await best.getByRole('button',{name:'Назначить'}).click();
  await expect.poll(()=>db.tables.orders[1].master_staff_id).toBe('m');
  expect(db.tables.orders[1].amount).toBe(2000);
  expect(db.tables.orders[1].master_payout).toBe(1105);
});

test('smart dispatcher stays desktop-only',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fullStack(page,'dispatcher');
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.dbSmartAssign')).toHaveCount(0);
});
