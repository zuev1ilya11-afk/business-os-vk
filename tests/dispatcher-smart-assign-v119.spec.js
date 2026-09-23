const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('new dispatcher order shows ranked masters, load and free windows before save',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  db.tables.business_staff.push({id:'m2',external_id:'staff_m2',full_name:'Московский мастер',role:'master',is_active:true,phone:'+79990000002',login:'m2',password_hash:'audit-password',city:'Москва'});
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});

  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_SMART_ASSIGN_V119===true);
  await page.locator('nav [data-page=orders]').click();
  await page.locator('.dmNewOrder').click();

  await page.locator('input[name="scheduled_date"]').fill(today());
  await page.locator('select[name="time_slot"]').selectOption({label:'11:00–12:00'});
  await page.locator('#bosService').selectOption('4');

  const box=page.locator('.dsa119Form');
  await expect(box).toBeVisible();
  const best=box.locator('.dsa119Candidate').first();
  await expect(best).toContainText('Тестовый мастер');
  await expect(best).toContainText('город совпадает');
  await expect(best).toContainText('1 заяв.');
  await expect(best.locator('.dsa119Times')).toContainText('10:00');

  await best.getByRole('button',{name:/Выбрать/}).click();
  await expect(page.locator('select[name="master_vk_id"]')).toHaveValue('staff_m');
  await expect(page.locator('select[name="time_slot"]')).toHaveValue('10:00–11:00');
  expect(db.tables.orders).toHaveLength(2);
});

test('mobile dispatcher can confirm a recommended master for an unassigned order',async({page})=>{
  const {db}=await fullStack(page,'dispatcher');
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00',city:'Санкт-Петербург'});

  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_SMART_ASSIGN_V119===true);
  await page.locator('nav [data-page=orders]').click();

  const card=page.locator('#bosOrderList .opsCompactOrder').filter({hasText:'Борис'});
  await expect(card.getByRole('button',{name:'Подобрать мастера'})).toBeVisible();
  await card.getByRole('button',{name:'Подобрать мастера'}).click();
  await expect(page.getByRole('heading',{name:'Подобрать мастера'})).toBeVisible();
  await expect(page.locator('#dsa119ModalList')).toContainText('Тестовый мастер');

  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#dsa119ModalList .dsa119Pick').first().click();
  await expect.poll(()=>db.tables.orders[1].master_staff_id).toBe('m');
  await expect.poll(()=>db.tables.orders[1].scheduled_time).toBe('10:00');
  expect(db.tables.orders[1].amount).toBe(2000);
  expect(db.tables.orders[1].master_payout).toBe(1105);
});
