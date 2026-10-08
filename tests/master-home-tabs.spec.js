const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');
const path=require('node:path');
async function fixture(page){
 await page.clock.setFixedTime(new Date('2026-10-08T15:00:00Z'));
 const {db,master}=await fullStack(page,'master');
 const base={...db.tables.orders[0],created_at:'2026-10-08T08:00:00Z',scheduled_date:null,scheduled_time:null,time_slot:null,phone:'+7 999 123-45-67; +7 999 987-65-43',master_called_at:null,master_agreed_at:null,master_contact_status:null,master_contact_history:[],master_contact_comment:null,master_contact_callback_at:null,reschedule_requested:false};
 db.tables.orders=[
 {...base,id:'11',external_id:'hands:7357206',scheduled_date:'2026-10-08',scheduled_time:'19:00',address:'Комендантский пр., 63',work:'Установка карниза ×2\nПодрезка карниза ×2\nЗамер ×1',master_called_at:'2026-10-08T09:00:00Z',master_agreed_at:'2026-10-08T09:05:00Z',master_contact_status:'agreed',master_contact_comment:'Будут дома к 19:00. Карниз куплен.'},
 {...base,id:'12',scheduled_date:'2026-10-09',scheduled_time:'11:00',address:'ул. Парашютная, 17к2',work:'Шторы ×4'},
 {...base,id:'13',scheduled_date:'2026-10-10',address:'ул. Гданьская, 5к1',work:'Карниз'},
 {...base,id:'14',address:'ул. Яхтенная, 40, подъезд 1',work:'Карниз ×2'},
 {...base,id:'15',address:'Очень длинный адрес: Санкт-Петербург, улица Оптиков, дом 34, корпус 2, парадная 14, квартира 170',work:'Монтаж карниза ×2\nПодрезка ×2\nЗамер ×1\nУстановка жалюзи ×4'},
 {...base,id:'16',address:'Комендантский пр., 66к1',master_contact_status:'no_answer',master_contact_comment:'Не ответил на звонок.',master_contact_callback_at:'2026-10-08T16:30:00Z'},
 {...base,id:'17',address:'Выборгское шоссе, 5к1',master_contact_status:'waiting_delivery',master_contact_comment:'Доставка 12 октября, затем монтаж. '+ 'Уточнить с клиентом наличие крепежа. '.repeat(8)},
 {...base,id:'18',address:'ул. Парашютная, 17к2',scheduled_date:'2026-10-07',reschedule_requested:true,reschedule_requested_at:'2026-10-08T10:00:00Z',reschedule_reason:'Клиент перенёс, новую дату уточним.'}
 ];
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();await expect(page.locator('#masterDailyV127')).toBeVisible();return{db,master};
}
for(const width of [360,390,430,1280])test(`three tabs are legible, complete and scoped at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:940});await fixture(page);const home=page.locator('#masterDailyV127');
 await expect(home.getByRole('heading',{name:'Мой рабочий день',exact:true})).toBeVisible();
 for(const [group,label,count] of [['days','По дням',3],['new','Новые',2],['waiting','Ожидание',3]]){
  await home.getByRole('tab',{name:new RegExp(label)}).click();await expect(home.locator('.masterV127Card:visible')).toHaveCount(count);
  await expect(home.getByRole('tab',{name:new RegExp(label)})).toHaveAttribute('aria-selected','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if(width===390)await page.screenshot({path:path.resolve('../screenshots',`master-home-${group}.png`),fullPage:true});
 }
 await home.getByRole('tab',{name:/По дням/}).click();await expect(home).toContainText('Сегодня · 8 октября');await expect(home).toContainText('Завтра · 9 октября');await expect(home).toContainText('Время уточняется');await expect(home).toContainText('Подрезка карниза ×2');
 await expect(home.locator('[data-order-id="12"]')).toContainText('Нужно связаться');
 await home.getByRole('button',{name:'Перезвонить сегодня · 1'}).click();await expect(home.locator('.masterV127Card:visible')).toHaveCount(1);await expect(home.locator('.masterV127Card:visible')).toHaveAttribute('data-order-id','16');
 await home.getByRole('button',{name:'Показать все заявки'}).click();await home.getByRole('tab',{name:/Новые/}).click();await home.locator('[data-order-id="14"]').getByRole('button',{name:/^Открыть заявку №/}).click();await expect(page.locator('#modalRoot .modal')).toBeVisible();
});
test('home result saves through existing backend, regrouping and surviving reload; failed write stays unsaved',async({page})=>{
 const {db}=await fixture(page);const home=page.locator('#masterDailyV127');await home.getByRole('tab',{name:/Новые/}).click();
 await home.locator('[data-order-id="14"]').getByRole('button',{name:'Указать итог связи',exact:true}).click();
 await page.getByRole('button',{name:'+79991234567',exact:true}).click();
 await expect(page.locator('#masterContactResultForm')).toBeVisible();await page.locator('input[name=result][value=waiting_delivery]').check();await page.locator('#masterContactResultForm textarea').fill('Ждут доставку в пятницу');
 await page.locator('#masterContactResultForm button[type=submit]').click();await expect(page.locator('#masterContactResultForm')).toHaveCount(0);
 expect(db.tables.orders.find(o=>o.id==='14').master_contact_status).toBe('waiting_delivery');
 await page.evaluate(()=>closeModal());await home.getByRole('tab',{name:/Ожидание/}).click();await expect(home.locator('[data-order-id="14"]')).toContainText('Ждут доставку в пятницу');
 await page.reload();await expect(page.locator('#authGate')).toBeHidden();await home.getByRole('tab',{name:/Ожидание/}).click();await expect(home.locator('[data-order-id="14"]')).toContainText('Ждут доставку в пятницу');
 await home.locator('[data-order-id="14"]').getByRole('button',{name:'Изменить итог связи',exact:true}).click();
 await page.locator('input[name=result][value=thinking]').check();await page.route(/master-workflow-api(?:\?|$)/,r=>r.fulfill({status:403,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:false,error:'Тест: сохранение недоступно'})}));await page.locator('#masterContactResultForm button[type=submit]').click();
 await expect(page.locator('.bosContactResultMsg')).toContainText('Тест: сохранение недоступно');expect(db.tables.orders.find(o=>o.id==='14').master_contact_status).toBe('waiting_delivery');await expect(home.locator('[data-order-id="14"]')).toContainText('Ждут доставку в пятницу');
});
test('background updates preserve selected tab and scroll, show refresh errors and never fetch each card',async({page})=>{
 await fixture(page);const home=page.locator('#masterDailyV127');await home.getByRole('tab',{name:/Ожидание/}).click();await page.evaluate(()=>scrollTo(0,350));const before=await page.evaluate(()=>scrollY);
 await page.evaluate(()=>{state.orders.find(o=>o.id==='17').master_contact_comment='Обновлено диспетчером';window.dispatchEvent(new CustomEvent('bos:employee-data-refreshed'));window.BOS_MASTER_DAILY_HOME_V127_API.refresh();});await expect(home.locator('[data-order-id="17"]')).toContainText('Обновлено диспетчером');await expect(home.getByRole('tab',{name:/Ожидание/})).toHaveAttribute('aria-selected','true');expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(3);
 await page.evaluate(()=>{window.BOS_LAST_REFRESH_ERROR='Нет сети';window.dispatchEvent(new CustomEvent('bos:employee-data-refresh-error'));});await expect(home.getByRole('status')).toContainText('Не удалось обновить');await expect(home.locator('.masterV127Card:visible')).toHaveCount(3);
});
module.exports={fixture};
test('an extra callback preserves departure and legacy timestamps advance through the existing server action',async({page})=>{
 const {db}=await fixture(page);const order=db.tables.orders.find(o=>o.id==='11');
 Object.assign(order,{master_contact_status:'call_later',master_contact_updated_at:'2026-10-08T12:00:00Z',master_contact_callback_at:'2026-10-08T16:30:00Z'});
 await page.evaluate(o=>{Object.assign(state.orders.find(x=>x.id===o.id),o);window.BOS_MASTER_DAILY_HOME_V127_API.refresh();},order);
 const card=page.locator('.masterV127Card[data-order-id="11"]');await expect(card).toContainText('Перезвонить');await expect(card.getByRole('button',{name:'Подтвердить выезд',exact:true})).toBeEnabled();
 Object.assign(order,{master_departed_at:'2026-10-08T14:00:00Z'});
 await page.evaluate(o=>{Object.assign(state.orders.find(x=>x.id===o.id),o);window.BOS_MASTER_DAILY_HOME_V127_API.refresh();},order);
 await card.getByRole('button',{name:'Начать работу',exact:true}).click();await expect(page.locator('.moa179Steps')).toContainText('Отправить отчёт');expect(order.master_started_at).toBeTruthy();
});
test('home result and agreement move an undated order to its saved day without reload',async({page})=>{
 const {db}=await fixture(page);const home=page.locator('#masterDailyV127');await home.getByRole('tab',{name:/Новые/}).click();
 await home.locator('[data-order-id="14"]').getByRole('button',{name:'Указать итог связи',exact:true}).click();await page.getByRole('button',{name:'+79999876543',exact:true}).click();
 // Opening the form creates no attempt until the master records the result.
 expect(db.tables.orders.find(o=>o.id==='14').master_contact_history).toHaveLength(0);
 await page.locator('input[name=result][value=agreed]').check();await page.locator('#masterContactResultForm textarea').fill('Согласован монтаж 10 октября');await page.locator('#masterContactResultForm button[type=submit]').click();
 const form=page.locator('#masterOrderAgree179Form');await expect(form).toBeVisible();await form.locator('input[name=scheduled_date]').fill('2026-10-10');await form.locator('input[name=scheduled_time]').fill('12:00');await form.locator('button[type=submit]').click();await expect(form).toHaveCount(0);
 const saved=db.tables.orders.find(o=>o.id==='14');expect(saved.scheduled_date).toBe('2026-10-10');expect(saved.master_contact_phone).toBe('+79999876543');
 await page.evaluate(()=>closeModal());await home.getByRole('tab',{name:/По дням/}).click();await expect(home.locator('[data-order-id="14"]')).toContainText('12:00');await expect(home.locator('[data-order-id="14"]')).toContainText('Согласовано');await expect(home.getByRole('tab',{name:/Новые/})).toContainText('1');
});
