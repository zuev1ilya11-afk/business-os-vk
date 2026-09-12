const {test,expect}=require('@playwright/test');

async function bootAs(page,role='owner'){
  await page.addInitScript(()=>{
    const token='admin.9999999999.testsignature';
    localStorage.setItem('bos_vk_session_v2',token);
    sessionStorage.setItem('bos_vk_session_v2',token);
  });
  const me={id:role==='owner'?'owner1':'manager1',external_id:role==='owner'?'100':'200',vk_user_id:role==='owner'?'100':'200',full_name:role==='owner'?'Владелец':'Руководитель',role,city:'Санкт-Петербург',is_active:true};
  const active={id:'master1',external_id:'staff_master1',vk_user_id:'staff_master1',full_name:'Активный мастер',role:'master',city:'Санкт-Петербург',phone:'+79990000001',is_active:true};
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route('**/api/proxy/mini-app-api',async route=>{
    const b=route.request().postDataJSON()||{};
    const body={ok:true,user:me,orders:[],users:[me,active],masters:[active],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{permissions:{can_manage_staff:true}}};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

test('owner can set employee credentials and restore disabled employee',async({page})=>{
  await bootAs(page,'owner');
  let credentialsSaved=false,restored=false;
  const staff=[
    {id:'master1',external_id:'staff_master1',vk_user_id:'staff_master1',full_name:'Активный мастер',role:'master',phone:'+79990000001',city:'Санкт-Петербург',is_active:true,login:'master.one',has_password:false},
    {id:'dispatcher1',external_id:'staff_dispatcher1',vk_user_id:'staff_dispatcher1',full_name:'Отключённый диспетчер',role:'dispatcher',phone:'+79990000002',city:'Санкт-Петербург',is_active:false,login:'',has_password:false}
  ];
  await page.route('**/api/proxy/staff-admin-api',async route=>{
    const b=route.request().postDataJSON()||{};
    expect(route.request().headers()['x-bos-session']).toBe('admin.9999999999.testsignature');
    if(b.action==='listStaff')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,staff})});
    if(b.action==='setCredentials'){
      credentialsSaved=b.id==='master1'&&b.login==='master.new'&&b.password==='secret12';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{...staff[0],login:b.login,has_password:true}})});
    }
    if(b.action==='restoreEmployee'){
      restored=b.id==='dispatcher1';staff[1].is_active=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:staff[1]})});
    }
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({ok:false,error:'UNKNOWN_ACTION'})});
  });

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
  await page.locator('nav button[data-page="team"]').click();
  await page.getByRole('button',{name:'Логины и пароли'}).click();
  const modal=page.locator('#modalRoot');
  await modal.getByRole('button',{name:/Активный мастер/}).click();
  const form=page.locator('#staffCredForm');
  await form.locator('[name=login]').fill('master.new');
  await form.locator('[name=password]').fill('secret12');
  await form.getByRole('button',{name:'Сохранить логин и пароль'}).click();
  await expect.poll(()=>credentialsSaved).toBeTruthy();
  await expect(page.locator('#staffCredMsg')).toContainText('сохранены');

  await modal.getByRole('button',{name:/Назад/}).click();
  await modal.getByRole('button',{name:'Отключённые'}).click();
  await modal.getByRole('button',{name:/Отключённый диспетчер/}).click();
  await modal.getByRole('button',{name:'Вернуть сотрудника'}).click();
  await expect.poll(()=>restored).toBeTruthy();
});

test('manager sees staff access controls',async({page})=>{
  await bootAs(page,'manager');
  await page.route('**/api/proxy/staff-admin-api',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,staff:[{id:'master1',full_name:'Мастер',role:'master',is_active:true,login:'',has_password:false}]})}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.locator('nav button[data-page="team"]').click();
  await expect(page.getByRole('button',{name:'Логины и пароли'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Отключённые'})).toBeVisible();
});
