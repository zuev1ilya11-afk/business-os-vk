const {test,expect}=require('@playwright/test');

test('mobile VK auth falls back to access token and can create an order',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:`window.vkBridge={send:async(name,params)=>{if(name==='VKWebAppGetAuthToken'){window.__authScope=(params&&params.scope)||'';return {access_token:'test_vk_access_token'}};if(name==='VKWebAppGetLaunchParams')return {};return {}}};`}));
  let sessionCalls=0,created=false;
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',async route=>{sessionCalls++;const b=route.request().postDataJSON();expect(b.access_token).toBe('test_vk_access_token');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'1105117085.9999999999.testsignature'})})});
  const owner={id:'owner1',vk_user_id:'1105117085',external_id:'1105117085',full_name:'Владелец',role:'owner',city:'Москва',is_active:true};
  const master={id:'m1',vk_user_id:'1001',external_id:'1001',full_name:'Мастер Тест',role:'master',city:'Москва',is_active:true};
  let orders=[];
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',async route=>{
    const req=route.request(),b=req.postDataJSON()||{},h=req.headers();
    const authed=!!h['x-bos-session']||!!h['x-vk-launch-params'];
    if(!authed)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({ok:false,error:'Доступ не подтверждён'})});
    if(b.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:owner,orders,users:[owner,master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    if(b.action==='createOrder'){
      expect(h['x-bos-session']).toBeTruthy();
      created=true;const o={...b,id:'99',amount:Number(b.original_amount||0),master_payout:0};orders=[o];
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order:o})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await page.goto('/?force_vk_auth=1',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>sessionCalls,{timeout:15000}).toBeGreaterThan(0);
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
  expect(await page.evaluate(()=>window.__authScope)).toBe('');
  await page.locator('nav button[data-page="orders"]').click();
  await page.getByRole('button',{name:/Новая/}).click();
  const form=page.locator('#orderForm');
  await form.locator('[name=client]').fill('Тест');
  await form.locator('[name=address]').fill('Адрес');
  await form.locator('[name=work]').fill('Карниз');
  await form.locator('[name=original_amount]').fill('3788');
  await expect(form.locator('#calcPay')).toContainText('2 092,87');
  const rows=page.locator('.orderTotalRow');expect(await rows.count()).toBe(2);
  for(let i=0;i<2;i++){
    const row=rows.nth(i),label=row.locator('span'),value=row.locator('b');
    const a=await label.boundingBox(),b=await value.boundingBox();
    const overlap=!(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    expect(overlap).toBeFalsy();
  }
  await form.getByRole('button',{name:'Сохранить'}).click();
  await expect.poll(()=>created).toBeTruthy();
  await expect(page.getByText('Карниз')).toBeVisible();
});
