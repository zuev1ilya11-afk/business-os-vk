const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test.use({timezoneId:'America/Los_Angeles'});
async function fixture(page,width=390){
 await page.setViewportSize({width,height:844});
 await page.clock.setFixedTime(new Date('2026-10-30T09:00:00Z'));
 const ctx=await fullStack(page,'master');
 const base={...ctx.db.tables.orders[0],status:'Назначена',created_at:'2026-10-30T08:00:00Z',received_date:'2026-10-25',scheduled_date:null,scheduled_time:null,phone:'+79990000001',master_called_at:null,master_agreed_at:null,master_contact_status:null,master_contact_history:[],reschedule_requested:false};
 ctx.db.tables.orders=[
  {...base,id:'11',order_number:'15437',external_id:'hands:15437',scheduled_date:'2026-10-30',scheduled_time:'18:00'},
  {...base,id:'12',source:'Вручную',order_number:'РУЧНАЯ-1234567890'.repeat(5),received_date:'2026-10-20',address:'Санкт-Петербург, Оченьдлиннаяулица'.repeat(5)},
  {...base,id:'13',received_date:null,master_contact_status:'waiting_delivery'},
  {...base,id:'14',received_date:'Invalid Date',master_contact_status:'call_later',master_contact_callback_at:'2026-10-30T14:00:00+03:00'},
  {...base,id:'15',received_date:'2026-10-19',scheduled_date:'2026-10-29',scheduled_time:'10:00'},
  {...base,id:'16',status:'Выполнена',master_workflow_stage:'completed',completed_at:'2026-10-30T07:00:00Z'},
  {...base,id:'17',status:'Отменена',received_date:null},
  {...base,id:'18',status:'Рекламация',received_date:'2026-02-30'},
 ];
 await page.goto('/');await expect(page.locator('#authGate')).toBeHidden();
 await expect(page.locator('#masterDailyV127')).toBeVisible();
 return ctx;
}

test('home shows saved receipt beside the number without opening the order',async({page})=>{
 await fixture(page);
 const card=page.locator('.masterV127Card[data-order-id="11"]');
 await expect(card.locator('.masterV127CardTop')).toContainText('Поступила 25.10.2026');
 await expect(card.getByText('· Поступила 25.10.2026',{exact:true})).toBeVisible();
 await expect(card.locator('.masterV127When')).toContainText('30 октября');
});

async function fits(card){
 const header=card.locator('.masterV127CardTop');
 const receipt=card.locator('.bosMasterReceived');
 await expect(receipt).toBeVisible();
 expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 const boxes=await Promise.all([header.locator('.bosMasterOrderIdentity'),header.locator('.masterV127Badge'),card.locator('.masterV127Address')].map(e=>e.boundingBox()));
 const [identity,badge,address]=boxes;
 expect(identity.x+identity.width<=badge.x+1||badge.x+badge.width<=identity.x+1||identity.y+identity.height<=badge.y+1||badge.y+badge.height<=identity.y+1).toBe(true);
 expect(identity.y+identity.height).toBeLessThanOrEqual(address.y+1);
}

for(const width of [320,360,390,430,1280])test(`receipt stays visible across home groups with long values at ${width}px`,async({page},info)=>{
 const {db}=await fixture(page,width),before=structuredClone(db.tables.orders),home=page.locator('#masterDailyV127');
 const card=id=>home.locator(`.masterV127Card[data-order-id="${id}"]`);
 await fits(card('11'));await fits(card('15'));
 await home.getByRole('button',{name:/^Просрочено/}).click();
 await expect(card('15').locator('.bosMasterReceived')).toHaveText('· Поступила 19.10.2026');await fits(card('15'));
 await home.getByRole('tab',{name:/Новые/}).click();
 await expect(card('12').locator('.bosMasterReceived')).toHaveText('· Поступила 20.10.2026');await fits(card('12'));
 await home.getByRole('tab',{name:/Ожидание/}).click();
 for(const id of ['13','14']){await expect(card(id).locator('.bosMasterReceived')).toHaveText('· Дата поступления не указана');await fits(card(id));}
 await home.getByRole('button',{name:/Перезвонить сегодня/}).click();
 await expect(card('14')).toBeVisible();await fits(card('14'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(db.tables.orders).toEqual(before);
 await home.getByRole('button',{name:'Показать все заявки'}).click();
 await home.getByRole('tab',{name:/По дням/}).click();
 await home.getByRole('button',{name:'Все дни',exact:true}).click();
 await page.screenshot({path:info.outputPath(`receipt-home-${width}.png`),fullPage:true});
});

test('receipt remains correct in current, completed, cancelled and claim lists',async({page})=>{
 await fixture(page);
 await page.locator('nav button[data-page="orders"]').click();
 for(const [filter,id,text] of [['current','12','· Поступила 20.10.2026'],['done','16','· Поступила 25.10.2026'],['archive','17','· Дата поступления не указана'],['claim','18','· Дата поступления не указана']]){
  await page.evaluate(f=>setMasterOrdersFilter(f),filter);
  const card=page.locator(`.masterV125Card[data-master-order-id="${id}"]`);
  await expect(card.locator('.masterV125Title .bosMasterReceived')).toHaveText(text);
  await expect(card.locator('.bosMasterReceived')).toBeVisible();
  expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await card.getByRole('button',{name:'Открыть заявку',exact:true}).click();
  await expect(page.locator('.bosCompactReceived')).toHaveText(text);
  await page.getByRole('button',{name:'Закрыть заявку',exact:true}).click();
 }
});

test('missing and malformed receipt never falls back to creation or visit date',async({page})=>{
 await fixture(page);
 for(const received of [null,'','Invalid Date','2026-02-30','2026-13-01',0]){
  await page.evaluate(value=>{state.orders.find(o=>o.id==='11').received_date=value;window.BOS_MASTER_DAILY_HOME_V127_API.refresh();},received);
  await expect(page.locator('.masterV127Card[data-order-id="11"] .bosMasterReceived')).toHaveText('· Дата поступления не указана');
 }
});

test('refreshing a changed visit preserves receipt and existing open and phone actions',async({page})=>{
 const {db}=await fixture(page),order=db.tables.orders.find(o=>o.id==='11');
 Object.assign(order,{scheduled_date:'2026-11-01',scheduled_time:'17:00'});
 await page.evaluate(async()=>{await reloadData(true);window.BOS_MASTER_DAILY_HOME_V127_API.refresh();});
 const card=page.locator('.masterV127Card[data-order-id="11"]');
 await expect(card.locator('.masterV127When')).toContainText('1 ноября');
 await expect(card.locator('.bosMasterReceived')).toHaveText('· Поступила 25.10.2026');
 await expect(card.getByRole('link',{name:'Позвонить клиенту',exact:true})).toHaveAttribute('href','tel:+79990000001');
 await card.getByRole('button',{name:'Открыть заявку № 15437',exact:true}).click();
 await expect(page.locator('.bosCompactReceived')).toHaveText('· Поступила 25.10.2026');
 await expect(page.locator('.bosMasterWorkflow[data-bos-v179="1"]')).toBeVisible();
 await page.locator('.bosClientCallAction').dispatchEvent('click');
 await expect(page.locator('#masterContactResultForm')).toBeVisible();
});

test('copying one of two client phones still copies only the selected number',async({page})=>{
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:4173'});
 await fixture(page);
 await page.evaluate(()=>{state.orders.find(o=>o.id==='12').phone='+79990000001; +79990000002';window.BOS_MASTER_DAILY_HOME_V127_API.refresh();});
 await page.getByRole('tab',{name:/Новые/}).click();
 await page.locator('.masterV127Card[data-order-id="12"]').getByRole('button',{name:'Позвонить клиенту',exact:true}).click();
 await page.locator('.masterV127Phones [data-copy-phone="+79990000002"]').click();
 await expect(page.locator('.masterV127Phones [data-copy-phone="+79990000002"]')).toHaveText('Скопировано');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('+79990000002');
});
