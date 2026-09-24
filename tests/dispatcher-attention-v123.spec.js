const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

const day=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};

test('desktop dispatcher attention filters count and isolate operational problems without hiding unassigned queue',async({page})=>{
  const {db,master}=await fullStack(page,'dispatcher');
  const today=day(0);
  Object.assign(db.tables.orders[0],{scheduled_date:day(-1),scheduled_time:'09:00',time_slot:'09:00–10:00'});
  Object.assign(db.tables.orders[1],{scheduled_date:today,scheduled_time:'10:00',time_slot:'10:00–11:00',city:'Санкт-Петербург'});
  db.tables.orders.push(
    {id:'13',client:'Вера',address:'Адрес 13',work:'Монтаж',status:'В работе',amount:1500,master_staff_id:master.id,master_name:master.full_name,scheduled_date:today,scheduled_time:'11:00',time_slot:'11:00–12:00'},
    {id:'14',client:'Глеб',address:'Адрес 14',work:'Карниз',status:'Назначена',amount:1800,master_staff_id:master.id,master_name:master.full_name,scheduled_date:today,scheduled_time:'11:30',time_slot:'11:30–12:30'},
    {id:'15',client:'Дина',address:'Адрес 15',work:'Шторы',status:'В работе',amount:1700,master_staff_id:master.id,master_name:master.full_name,scheduled_date:today,scheduled_time:'13:00',time_slot:'13:00–14:00',reschedule_requested:true,reschedule_reason:'Клиент попросил позже'}
  );
  db.tables.staff_schedule.push({id:'attention_work',staff_id:master.id,work_date:today,is_working:true,work_start:'09:00',work_end:'15:00'});

  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.locator('#authGate')).toBeHidden();
  await page.waitForFunction(()=>!!window.BOS_DISPATCHER_ATTENTION_V123);
  await page.locator('nav [data-page=orders]').click();
  await page.getByRole('button',{name:'Список',exact:true}).click();

  const controls=page.locator('.da123Controls');
  await expect(controls).toBeVisible();
  await expect(controls.locator('[data-da123-filter="all"] b')).toHaveText('5');
  await expect(controls.locator('[data-da123-filter="overdue"] b')).toHaveText('1');
  await expect(controls.locator('[data-da123-filter="unassigned"] b')).toHaveText('1');
  await expect(controls.locator('[data-da123-filter="conflict"] b')).toHaveText('2');
  await expect(controls.locator('[data-da123-filter="reschedule"] b')).toHaveText('1');

  await expect(page.locator('.dbV94ListCard[data-order-id="11"] .da123Badge.overdue')).toHaveText('Просрочено');
  await expect(page.locator('.dbV94ListCard[data-order-id="12"] .da123Badge.unassigned')).toHaveText('Без мастера');
  await expect(page.locator('.dbV94ListCard[data-order-id="13"] .da123Badge.conflict')).toHaveText('Конфликт');
  await expect(page.locator('.dbV94ListCard[data-order-id="15"] .da123Badge.reschedule')).toHaveText('Перенос');

  const unassignedQueue=page.locator('.duq122');
  await expect(unassignedQueue).toBeVisible();
  await expect(unassignedQueue.locator('.duq122Item[data-order-id="12"]')).toBeVisible();

  const smart=page.locator('.dsd121[data-order-id="12"]');
  await expect(smart).toBeVisible();

  await controls.locator('[data-da123-filter="conflict"]').click();
  await expect(page.locator('.dbV94ListCard:visible')).toHaveCount(2);
  await expect(page.locator('.dbV94ListCard[data-order-id="13"]')).toBeVisible();
  await expect(page.locator('.dbV94ListCard[data-order-id="14"]')).toBeVisible();
  await expect(smart).toBeHidden();
  await expect(unassignedQueue).toBeVisible();

  await controls.locator('[data-da123-filter="unassigned"]').click();
  await expect(page.locator('.dbV94ListCard:visible')).toHaveCount(1);
  await expect(page.locator('.dbV94ListCard[data-order-id="12"]')).toBeVisible();
  await expect(smart).toBeVisible();

  await controls.locator('[data-da123-filter="all"]').click();
  await expect(page.locator('.dbV94ListCard:visible')).toHaveCount(5);
});
