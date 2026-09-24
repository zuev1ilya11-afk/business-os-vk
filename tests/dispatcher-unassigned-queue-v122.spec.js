const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>iso(new Date());
const yesterday=()=>{const d=new Date();d.setDate(d.getDate()-1);return iso(d)};

test('unassigned queue prioritizes urgent orders and assigns best recommendation without changing money',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  db.tables.staff_schedule.push({id:'queue122_today',staff_id:master.id,work_date:today(),is_working:true,work_start:'10:00',work_end:'14:00'});
  Object.assign(db.tables.orders[1],{scheduled_date:today(),scheduled_time:'',time_slot:'',city:'Санкт-Петербург',amount:2000,original_amount:2000,master_payout:1105});
  db.tables.orders.push({id:'13',client:'Срочный клиент',address:'Просроченный адрес',work:'Монтаж',status:'В работе',amount:3000,original_amount:3000,master_staff_id:null,source:'Звонок',scheduled_date:yesterday(),scheduled_time:'09:00',city:'Санкт-Петербург',master_workflow_stage:'assigned'});

  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>window.BOS_DISPATCHER_UNASSIGNED_QUEUE_V122===true);
  await page.locator('nav [data-page=orders]').click();
  await expect(page.locator('.duq122')).toHaveCount(0);
  await page.locator('.dbViewTabs button').filter({hasText:'Список'}).click();

  const queue=page.locator('.duq122');
  await expect(queue).toBeVisible();
  await expect(queue.locator('.duq122Item')).toHaveCount(2);
  await expect(queue.locator('.duq122Item').first()).toHaveAttribute('data-order-id','13');
  await expect(queue.locator('.duq122Item').first()).toContainText('Просрочена');

  const todayItem=queue.locator('.duq122Item[data-order-id="12"]');
  await expect(todayItem).toContainText('Сегодня');
  await expect(todayItem).toContainText('Тестовый мастер');
  await expect(todayItem).toContainText('10:00');

  page.once('dialog',dialog=>dialog.accept());
  await todayItem.getByRole('button',{name:'Назначить',exact:true}).click();

  await expect.poll(()=>db.tables.orders[1].master_staff_id).toBe(master.id);
  await expect.poll(()=>db.tables.orders[1].scheduled_time).toBe('10:00');
  expect(db.tables.orders[1].amount).toBe(2000);
  expect(db.tables.orders[1].master_payout).toBe(1105);
  await expect(queue.locator('.duq122Item[data-order-id="12"]')).toHaveCount(0);
});
