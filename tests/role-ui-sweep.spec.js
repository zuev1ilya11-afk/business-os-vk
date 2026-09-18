const {test,expect}=require('@playwright/test');

const roleNames={owner:'Владелец',manager:'Руководитель',dispatcher:'Диспетчер',master:'Мастер'};

async function bootAs(page,role){
  const roster=[
    {id:'manager_1',external_id:'manager_1',vk_user_id:'manager_1',full_name:'Марина Руководитель',role:'manager',city:'Москва',is_active:true},
    {id:'dispatcher_1',external_id:'dispatcher_1',vk_user_id:'dispatcher_1',full_name:'Дарья Диспетчер',role:'dispatcher',city:'Москва',is_active:true},
    {id:'master_1',external_id:'master_1',vk_user_id:'master_1',full_name:'Максим Мастер',role:'master',city:'Москва',specialization:'Монтаж',work_start:'09:00',work_end:'18:00',is_active:true},
  ];
  const user=role==='owner'
    ?{id:'owner_1',external_id:'owner_1',vk_user_id:'owner_1',full_name:'Илья Владелец',role:'owner',city:'Москва',is_active:true}
    :roster.find(item=>item.role===role);
  const orders=[
    {id:'ROLE-OWN',status:'В работе',client:'Свой клиент',address:'Своя улица',work:'Монтаж',amount:5000,scheduled_date:'2026-09-18',scheduled_time:'10:00',master_vk_id:'master_1',master_name:'Максим Мастер'},
    {id:'ROLE-OTHER',status:'В работе',client:'Чужой клиент',address:'Чужая улица',work:'Ремонт',amount:7000,scheduled_date:'2026-09-18',scheduled_time:'12:00',master_vk_id:'master_2',master_name:'Другой мастер'},
  ];
  const permissions={can_manage_orders:['owner','manager','dispatcher'].includes(role),can_manage_schedule:['owner','manager','dispatcher'].includes(role),can_manage_staff:['owner','manager'].includes(role),can_review_reports:['owner','manager','dispatcher'].includes(role),can_view_finance:['owner','manager'].includes(role)};

  await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','role-sweep-session'));
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route('**/api/proxy/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"claims":[],"orders":[],"masters":[]}'}));
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"claims":[],"orders":[],"masters":[]}'}));
  await page.route('**/api/proxy/mini-app-api',async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
    if(body.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user,orders,users:roster,masters:roster.filter(item=>item.role==='master'),masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{permissions}})});
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
  });

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toBeHidden({timeout:15000});
  await expect(page.locator('#roleBadge')).toHaveText(roleNames[role],{timeout:10000});
}

test('owner role keeps owner tools and employee creation',async({page})=>{
  await bootAs(page,'owner');
  await expect(page.locator('#ownerToolsBtn')).toBeVisible();
  await page.locator('nav button[data-page="team"]').click();
  await expect(page.getByRole('button',{name:'+ Сотрудник'})).toBeVisible();
});

test('manager role is labeled correctly without owner-only creation controls',async({page})=>{
  await bootAs(page,'manager');
  await expect(page.locator('#ownerToolsBtn')).toBeHidden();
  await expect(page.locator('nav button[data-page="team"]')).toHaveText('Команда');
  await page.locator('nav button[data-page="team"]').click();
  await expect(page.getByRole('button',{name:'+ Сотрудник'})).toHaveCount(0);
  await expect(page.locator('#roleBadge')).toHaveText('Руководитель');
});

test('dispatcher role gets dispatcher navigation without owner tools',async({page})=>{
  await bootAs(page,'dispatcher');
  await expect(page.locator('#ownerToolsBtn')).toBeHidden();
  await expect(page.locator('nav button[data-page="team"]')).toHaveText('Мастера');
  await expect(page.locator('#content')).toContainText('Заявки за месяц');
  await expect(page.locator('#content')).toContainText('Требуют внимания');
  await expect(page.getByRole('button',{name:'+ Сотрудник'})).toHaveCount(0);
});

test('master role sees only assigned orders and master navigation',async({page})=>{
  await bootAs(page,'master');
  await expect(page.locator('#ownerToolsBtn')).toBeHidden();
  await expect(page.locator('nav button[data-page="orders"]')).toHaveText('Мои заявки');
  await expect(page.locator('nav button[data-page="team"]')).toHaveText('Профиль');
  await page.locator('nav button[data-page="orders"]').click();
  await expect(page.locator('#content')).toContainText('ROLE-OWN');
  await expect(page.locator('#content')).not.toContainText('ROLE-OTHER');
  await expect(page.locator('#content')).not.toContainText('Чужой клиент');
});
