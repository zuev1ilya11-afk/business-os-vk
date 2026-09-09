const { test, expect } = require('@playwright/test');

test('launch smoke: Mini App loads, data renders, actions and report review work', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  const seedMaster = { vk_user_id:'master_seed', full_name:'Александр Мастер', phone:'70000000000', city:'Москва', role:'master', is_active:true, specialization:'Монтаж', work_start:'09:00', work_end:'18:00' };
  const data={orders:[
    {id:'ACTIVE-1',status:'В работе',client:'Клиент 2',address:'Адрес 2',work:'Шторы',amount:2800,original_amount:2800,scheduled_date:'2099-09-10',scheduled_time:'09:00',time_slot:'09:00–10:00',master_vk_id:'master_seed',master_name:'Александр Мастер',wall_material:'Кирпич',wall_over_3m:true,possible_extra_work:true,comment:'Позвонить заранее'},
    {id:'REPORT-1',status:'Выполнена',client:'Клиент отчёт',address:'Адрес отчёт',work:'Монтаж',amount:2300,original_amount:2800,master_vk_id:'master_seed',master_name:'Александр Мастер',master_payout:1270.75,extra_work_amount:300,uncompleted_work_amount:500,report_uploaded_at:'2026-09-09T03:00:00Z',report_review_status:'pending',report_act_url:'https://example.com/act.pdf',report_photo_urls:'["https://example.com/photo.jpg"]'}
  ],users:[seedMaster],masters:[seedMaster],masterSchedule:[]};

  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api', async route=>{
    let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
    const action=body.action||'bootstrap';let result={ok:true};
    if(action==='health') result={ok:true,version:'2026-09-09-launch2-auth'};
    else if(action==='bootstrap') result={ok:true,user:{full_name:'Илья',role:'owner',city:'Москва',vk_user_id:'1105117085'},orders:data.orders,users:data.users,masters:data.masters,sources:[{source:'VK'}],settings:{reports_drive_folder_url:'https://drive.google.com/drive/folders/test'},masterSchedule:data.masterSchedule};
    else if(action==='createOrder'){const order={id:'TEST-1',status:body.status||'В работе',master_name:'',master_payout:0,...body};delete order.action;data.orders.unshift(order);result={ok:true,order};}
    else if(action==='updateOrder'){const i=data.orders.findIndex(x=>String(x.id)===String(body.id));data.orders[i]={...data.orders[i],...body};delete data.orders[i].action;result={ok:true,order:data.orders[i]};}
    else if(action==='reviewReport'){const i=data.orders.findIndex(x=>String(x.id)===String(body.id));data.orders[i]={...data.orders[i],report_review_status:body.decision,report_review_comment:body.comment||'',status:body.decision==='rejected'?'В работе':'Выполнена'};result={ok:true,order:data.orders[i]};}
    else if(action==='addEmployee'){const user={id:'staff-test-id',vk_user_id:'staff_test',full_name:body.full_name,phone:body.phone||'',city:body.city||'Москва',role:body.role||'master',is_active:true};const master=user.role==='master'?{...user,specialization:body.specialization||'',work_start:body.work_start||'09:00',work_end:body.work_end||'18:00'}:null;data.users.push(user);if(master)data.masters.push(master);result={ok:true,user,master};}
    else if(action==='saveMasterSchedule'){data.masterSchedule=(body.days||[]).map(d=>({...d,master_vk_id:body.master_vk_id||body.master_id,week_start:body.week_start}));result={ok:true,schedule:data.masterSchedule};}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,claims:[],orders:[],masters:[]})}));

  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Домашний мастер'}).first()).toBeVisible();
  await expect(page.getByText('VK MINI APP')).toHaveCount(0);
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
  await expect(page.getByText('Отчёты на проверку')).toBeVisible();
  await expect(page.getByText('REPORT-1 · Монтаж')).toBeVisible();

  const firstDash=page.locator('.dashMetric.buttonCard').first();
  await expect(firstDash).toBeVisible();
  const layout=await firstDash.evaluate(el=>{const icon=el.querySelector('.dashIcon').getBoundingClientRect(),label=el.querySelector('.metricLabel').getBoundingClientRect(),value=el.querySelector('strong').getBoundingClientRect();return{iconRight:icon.right,labelLeft:label.left,labelBottom:label.bottom,valueTop:value.top}});
  expect(layout.iconRight).toBeLessThanOrEqual(layout.labelLeft);
  expect(layout.labelBottom).toBeLessThanOrEqual(layout.valueTop+1);

  await page.getByText('REPORT-1 · Монтаж').click();
  await expect(page.getByRole('heading',{name:'Проверка отчёта REPORT-1'})).toBeVisible();
  await expect(page.getByRole('link',{name:'📄 Открыть акт'})).toBeVisible();
  await page.getByRole('button',{name:'Принять'}).click();
  await expect(page.getByText('Новых отчётов на проверку нет.')).toBeVisible();

  const metric=page.locator('.dashMetric.buttonCard').first();await expect(metric).toBeVisible();await metric.click();
  await expect(page.getByRole('heading',{name:'Заявки'})).toBeVisible();
  await page.getByRole('button',{name:'+ Новая'}).click();
  await page.locator('input[name="client"]').fill('Тест');
  await page.locator('input[name="address"]').fill('Тестовый адрес');
  await page.locator('input[name="work"]').fill('Монтаж');
  await page.locator('input[name="original_amount"]').fill('1000');
  await page.locator('select[name="time_slot"]').selectOption({label:'09:00–10:00'});
  await page.locator('select[name="wall_material"]').selectOption('Кирпич');
  await page.locator('input[name="wall_over_3m"]').check();
  await page.locator('textarea[name="comment"]').fill('Комментарий тест');
  await page.getByRole('button',{name:'Сохранить'}).click();
  await expect(page.getByText('TEST-1')).toBeVisible();
  await page.getByText('TEST-1').click();await expect(page.getByText('Комментарий тест')).toBeVisible();
  await page.getByRole('button',{name:'Редактировать'}).click();await page.locator('input[name="work"]').fill('Монтаж 2');await page.getByRole('button',{name:'Сохранить'}).click();await expect(page.getByText('Монтаж 2')).toBeVisible();
  await page.getByRole('button',{name:/Команда/}).click();
  await page.getByRole('button',{name:'+ Сотрудник'}).click();
  await page.locator('input[name="full_name"]').fill('Новый мастер');
  await expect(page.locator('input[name="vk_user_id"]')).toHaveCount(0);
  await page.locator('input[name="phone"]').fill('+79991234567');
  await page.getByRole('button',{name:'Добавить'}).click();
  await expect(page.getByText('Новый мастер')).toBeVisible();
  await page.getByRole('button',{name:/График/}).click();await expect(page.getByText('График мастеров',{exact:true})).toBeVisible();
  await expect(page.locator('nav [data-action="profile"]')).toBeVisible();
});