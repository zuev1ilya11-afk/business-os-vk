const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const workingDay=staff_id=>({id:`free_slots_${staff_id}`,staff_id,work_date:today(),is_working:true,work_start:'10:00',work_end:'14:00'});

async function openFreeSlots(page){
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_FREE_SLOTS_V120===true);
  await page.locator('nav [data-page="dispatch"]').click();
  await expect(page.locator('.dfs120Panel')).toBeVisible();
}

test('dispatcher free slots exclude busy hours and show daily load',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  db.tables.staff_schedule.push(workingDay(master.id));
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'12:00',time_slot:'12:00–13:00'});

  await page.setViewportSize({width:1440,height:900});
  await openFreeSlots(page);

  const card=page.locator('.dfs120Master').filter({hasText:'Тестовый мастер'});
  await expect(card).toBeVisible();
  await expect(card).toContainText('10:00–14:00');
  await expect(card).toContainText('1 заяв.');
  await expect(card.getByRole('button',{name:'Тестовый мастер 10:00'})).toBeVisible();
  await expect(card.getByRole('button',{name:'Тестовый мастер 11:00'})).toHaveCount(0);
  await expect(card.getByRole('button',{name:'Тестовый мастер 12:00'})).toBeVisible();
  await expect(card.getByRole('button',{name:'Тестовый мастер 13:00'})).toBeVisible();
  await expect(page.locator('.dfs120Stats')).toContainText('3 свободных окон');
  await expect(page.locator('.dfs120Stats')).toContainText('1 без мастера');
});

test('dispatcher assigns an unassigned order from a free slot without changing money',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  db.tables.staff_schedule.push(workingDay(master.id));
  Object.assign(db.tables.orders[0],{scheduled_date:today(),scheduled_time:'11:00',time_slot:'11:00–12:00'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'12:00',time_slot:'12:00–13:00'});

  await page.setViewportSize({width:390,height:844});
  await openFreeSlots(page);

  await page.getByRole('button',{name:'Тестовый мастер 10:00'}).click();
  const modal=page.locator('.modal');
  await expect(modal.getByRole('heading',{name:'Назначить заявку'})).toBeVisible();
  await expect(modal.locator('#dfs120Orders')).toContainText('Борис');

  page.once('dialog',dialog=>dialog.accept());
  await modal.locator('.dfs120Order').filter({hasText:'Борис'}).click();

  await expect.poll(()=>db.tables.orders[1].master_staff_id).toBe(master.id);
  await expect.poll(()=>db.tables.orders[1].scheduled_time).toBe('10:00');
  expect(db.tables.orders[1].amount).toBe(2000);
  expect(db.tables.orders[1].master_payout).toBe(1105);
  await expect(page.locator('.dfs120Panel')).toContainText('Тестовый мастер');
});
