const { test, expect } = require('@playwright/test');

const sizes=[{name:'small-ios',width:320,height:700},{name:'iphone',width:390,height:844},{name:'android',width:430,height:900}];
for(const s of sizes){
  test(`master UI is simple and fits ${s.name}`,async({page})=>{
    await page.setViewportSize({width:s.width,height:s.height});
    await page.addInitScript(()=>localStorage.setItem('bos_vk_session_v2','test-session-master'));
    const master={id:'m1',vk_user_id:'1001',external_id:'1001',full_name:'Александр Мастер',phone:'70000000000',city:'Санкт-Петербург',role:'master',is_active:true,specialization:'Монтаж',work_start:'09:00',work_end:'18:00'};
    const orders=[
      {id:'M-1',status:'В работе',client:'Клиент',address:'Невский проспект 1',work:'Карниз',scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00',master_vk_id:'1001',master_name:'Александр Мастер',master_payout:2463.05,wall_material:'Кирпич',wall_over_3m:true,possible_extra_work:true,comment:'Позвонить заранее'},
      {id:'M-2',status:'Выполнена',client:'Клиент 2',address:'Адрес 2',work:'Шторы',scheduled_date:'2099-09-09',scheduled_time:'12:00',master_vk_id:'1001',master_name:'Александр Мастер',master_payout:1200,extra_work_amount:300,uncompleted_work_amount:200}
    ];
    const miniHandler=async route=>{
      let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
      const action=body.action||'bootstrap';
      let result={ok:true};
      if(action==='health')result={ok:true,version:'2026-09-12-netlify-gateway'};
      else if(action==='bootstrap')result={ok:true,user:master,orders,users:[master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{permissions:{can_manage_staff:false}}};
      else if(action==='saveMasterSchedule')result={ok:true,schedule:(body.days||[]).map(d=>({...d,master_vk_id:'1001',week_start:body.week_start}))};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    };
    await page.route('**/api/proxy/mini-app-api',miniHandler);
    await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',miniHandler);

    const claimsHandler=route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,claims:[],orders:[]})});
    await page.route('**/api/proxy/claims-api',claimsHandler);
    await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api',claimsHandler);

    await page.goto('/',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#authGate')).toBeHidden();
    await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toHaveCount(0);
    await expect(page.getByText('Моя выплата',{exact:true})).toBeVisible();
    await expect(page.getByText('Общая зарплата',{exact:true})).toBeVisible();
    await expect(page.getByText('Выручка')).toHaveCount(0);
    await expect(page.getByText('Сумма заявок')).toHaveCount(0);
    const upcoming=page.locator('.bosMasterUpcomingCard').first();
    await expect(upcoming).toContainText('№ M-1');
    await expect(upcoming).toContainText('2 463,05 ₽');
    await expect(upcoming).toContainText('10:00');
    await expect(upcoming).not.toContainText('Невский');
    await expect(upcoming).not.toContainText('Карниз');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const kpis=page.locator('.masterKpi');
    const count=await kpis.count();
    for(let i=0;i<count;i++){const box=await kpis.nth(i).boundingBox();expect(box.width).toBeGreaterThan(100);expect(box.height).toBeGreaterThan(80)}

    await page.locator('nav button[data-page="orders"]').click();
    await expect(page.getByText('Выплата: 2 463,05 ₽',{exact:true})).toBeVisible();
    await expect(page.getByText('4 458 ₽',{exact:true})).toHaveCount(0);
    await page.evaluate(()=>openOrder('M-1'));
    const modal=page.locator('.modal.show, .modal.open, .modal').filter({hasText:'№ M-1'}).last();
    await expect(modal.getByText('Выплата: 2 463,05 ₽',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Отчитаться по заявке'})).toBeVisible();
    await expect(page.getByText('Исходная сумма',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Итоговая сумма заявки',{exact:true})).toHaveCount(0);
    await expect(page.getByText('4 458 ₽',{exact:true})).toHaveCount(0);
    await page.evaluate(()=>closeModal());

    await page.locator('nav button[data-page="dispatch"]').click();
    await expect(page.getByText('Мой график')).toBeVisible();
    await expect(page.locator('#masterMonthCalendar')).toBeVisible();
    await expect(page.getByRole('button',{name:'Сохранить график'})).toBeVisible();

    const teamButton=page.locator('nav button[data-page="team"]');
    if(await teamButton.count()){
      await teamButton.click();
      await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible();
      await expect(page.getByRole('button',{name:'+ Сотрудник'})).toHaveCount(0);
      await expect(page.getByText('Управление сотрудниками',{exact:true})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Логины и пароли'})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Отключённые'})).toHaveCount(0);
    }

    await page.evaluate(()=>window.openEmployeeForm?.());
    await expect(page.getByText('Новый сотрудник',{exact:true})).toHaveCount(0);
    await page.evaluate(()=>window.openStaffAccess?.('all'));
    await expect(page.getByText('Доступы сотрудников',{exact:true})).toHaveCount(0);
  });
}
