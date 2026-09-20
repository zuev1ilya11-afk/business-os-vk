const {test,expect}=require('@playwright/test');
const {fullStack}=require('./helpers/full-stack.cjs');

test('notification center shows dispatcher reschedule and unassigned alerts',async({page})=>{
  await page.setViewportSize({width:1280,height:820});
  await page.addInitScript(()=>{
    localStorage.removeItem('bos_vk_session_v2');
    localStorage.setItem('bos_force_test_owner_form_v2','1');
    localStorage.setItem('bos_test_auth_v1',JSON.stringify({email:'owner@test.ru',password:'owner-test'}));
  });
  await page.route('**/api/proxy/mini-app-api',async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
    const action=body.action||'bootstrap';let result={ok:true};
    if(action==='health')result={ok:true,version:'local'};
    else if(action==='login')result={ok:true,token:'test-session-owner',user:{id:'owner',vk_user_id:'1',external_id:'1',full_name:'Владелец',role:'owner',is_active:true}};
    else if(action==='bootstrap')result={ok:true,user:{id:'owner',vk_user_id:'1',external_id:'1',full_name:'Владелец',role:'owner',is_active:true},orders:[
      {id:'N-1',status:'В работе',client:'Клиент',address:'Адрес 1',work:'Монтаж',scheduled_date:'2099-09-10',scheduled_time:'12:00',reschedule_requested:true,reschedule_reason:'Клиент попросил позже',reschedule_requested_at:'2099-09-09T12:00:00Z',master_vk_id:'1001',master_name:'Мастер'},
      {id:'N-2',status:'Новая',client:'Клиент 2',address:'Адрес 2',work:'Карниз',scheduled_date:'2099-09-10',scheduled_time:'14:00',master_vk_id:''}
    ],users:[],masters:[],masterSchedule:[],claims:[],sources:[],settings:{permissions:{can_manage_staff:true}}};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.route('**/api/proxy/claims-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,claims:[],orders:[]})}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeVisible();
  await page.locator('#authEmail').fill('owner@test.ru');
  await page.locator('#authPassword').fill('owner-test');
  await page.getByRole('button',{name:'Войти'}).click();
  await expect(page.locator('#authGate')).toBeHidden();
  const bell=page.locator('#bosNotificationBell');
  await expect(bell).toBeVisible();
  await expect(bell.locator('.bosNB')).toHaveText('2');
  await bell.click();
  const panel=page.getByRole('region',{name:'Центр уведомлений'});
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Перенос заявки №N-1')).toBeVisible();
  await expect(panel.getByText('Клиент попросил позже')).toBeVisible();
  await expect(panel.getByText('Без мастера · №N-2')).toBeVisible();
});

test('master notifications support master_staff_id, new assignment and schedule changes',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {db}=await fullStack(page,'master');
  const order=db.tables.orders.find(o=>String(o.id)==='11');
  order.scheduled_date='2099-09-10';
  order.scheduled_time='10:00';
  order.master_vk_id=null;
  await page.addInitScript(()=>localStorage.setItem('bos_notification_snapshot_v26:master:staff_master',JSON.stringify({'11':'|2099-09-10|10:00|В работе'})));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden();
  const bell=page.locator('#bosNotificationBell');
  await expect(bell).toBeVisible();
  await expect(bell.locator('.bosNB')).toHaveText('1');
  await bell.click();
  let panel=page.getByRole('region',{name:'Центр уведомлений'});
  await expect(panel.getByText('Новая заявка №11')).toBeVisible();
  await panel.getByRole('button',{name:'Закрыть'}).click();

  await page.evaluate(()=>{
    const o=state.orders.find(x=>String(x.id)==='11');
    o.scheduled_time='12:30';
    window.bosRefreshNotifications();
  });
  await expect(bell.locator('.bosNB')).toHaveText('2');
  await bell.click();
  panel=page.getByRole('region',{name:'Центр уведомлений'});
  await expect(panel.getByText('Изменено время заявки №11')).toBeVisible();
  await expect(panel.getByText(/12:30/)).toBeVisible();
});
