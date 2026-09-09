const { test, expect } = require('@playwright/test');

const sizes=[{name:'small-ios',width:320,height:700},{name:'iphone',width:390,height:844},{name:'android',width:430,height:900}];
for(const s of sizes){
  test(`master UI is simple and fits ${s.name}`,async({page})=>{
    await page.setViewportSize({width:s.width,height:s.height});
    const master={id:'m1',vk_user_id:'1001',external_id:'1001',full_name:'Александр Мастер',phone:'70000000000',city:'Санкт-Петербург',role:'master',is_active:true,specialization:'Монтаж',work_start:'09:00',work_end:'18:00'};
    const orders=[
      {id:'M-1',status:'В работе',client:'Клиент',address:'Невский проспект 1',work:'Карниз',scheduled_date:'2099-09-10',scheduled_time:'10:00',time_slot:'10:00–11:00',master_vk_id:'1001',master_name:'Александр Мастер',master_payout:1547,wall_material:'Кирпич',wall_over_3m:true,possible_extra_work:true,comment:'Позвонить заранее'},
      {id:'M-2',status:'Выполнена',client:'Клиент 2',address:'Адрес 2',work:'Шторы',scheduled_date:'2099-09-09',scheduled_time:'12:00',master_vk_id:'1001',master_name:'Александр Мастер',master_payout:1200,extra_work_amount:300,uncompleted_work_amount:200}
    ];
    await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',async route=>{
      let body={};try{body=route.request().postDataJSON()||{}}catch(_){}
      const action=body.action||'bootstrap';
      let result={ok:true};
      if(action==='bootstrap')result={ok:true,user:master,orders,users:[master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}};
      else if(action==='saveMasterSchedule')result={ok:true,schedule:(body.days||[]).map(d=>({...d,master_vk_id:'1001',week_start:body.week_start}))};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/claims-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,claims:[],orders:[]})}));
    await page.goto('/',{waitUntil:'domcontentloaded'});
    await expect(page.getByText('КАБИНЕТ МАСТЕРА')).toBeVisible();
    await expect(page.getByText('Моя выплата',{exact:true})).toBeVisible();
    await expect(page.getByText('Общая зарплата',{exact:true})).toBeVisible();
    await expect(page.getByText('Выручка')).toHaveCount(0);
    await expect(page.getByText('Сумма заявок')).toHaveCount(0);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const kpis=page.locator('.masterKpi');
    const count=await kpis.count();
    for(let i=0;i<count;i++){const box=await kpis.nth(i).boundingBox();expect(box.width).toBeGreaterThan(100);expect(box.height).toBeGreaterThan(80)}
    await page.getByRole('button',{name:/График/}).click();
    await expect(page.getByText('Мой календарь')).toBeVisible();
    await expect(page.getByRole('button',{name:'Сохранить график недели'})).toBeVisible();
  });
}
