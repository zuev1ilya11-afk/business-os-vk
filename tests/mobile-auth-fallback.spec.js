const {test,expect}=require('@playwright/test');

test('mobile VK auth falls back to access token and can create an order',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:`window.vkBridge={send:async(name,params)=>{if(name==='VKWebAppGetAuthToken'){window.__authScope=(params&&params.scope)||'';return {access_token:'test_vk_access_token'}};if(name==='VKWebAppGetLaunchParams')return {};return {}}};`}));
  let sessionCalls=0,created=false;
  const sessionHandler=async route=>{sessionCalls++;const b=route.request().postDataJSON();expect(b.access_token).toBe('test_vk_access_token');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'1105117085.9999999999.testsignature'})})};
  await page.route('**/api/proxy/vk-session-api',sessionHandler);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',sessionHandler);
  const owner={id:'owner1',vk_user_id:'1105117085',external_id:'1105117085',full_name:'Владелец',role:'owner',city:'Москва',is_active:true};
  const master={id:'m1',vk_user_id:'1001',external_id:'1001',full_name:'Мастер Тест',role:'master',city:'Москва',is_active:true};
  let orders=[];
  const miniAppHandler=async route=>{
    const req=route.request(),b=req.postDataJSON()||{},h=req.headers();
    const authed=!!h['x-bos-session']||!!h['x-vk-launch-params'];
    if(!authed)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({ok:false,error:'Доступ не подтверждён'})});
    if(b.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:owner,orders,users:[owner,master],masters:[master],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    if(b.action==='createOrder'){
      expect(h['x-bos-session']).toBeTruthy();
      created=true;const o={...b,id:'99',amount:Number(b.original_amount||0),master_payout:1126.93};orders=[o];
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order:o})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  };
  await page.route('**/api/proxy/mini-app-api',miniAppHandler);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',miniAppHandler);
  const orderMetaHandler=async route=>{
    const b=route.request().postDataJSON()||{};
    const order=orders.find(o=>String(o.id)===String(b.id))||orders[0]||{};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,order:{...order,order_type:b.order_type||'work'}})});
  };
  await page.route('**/api/proxy/order-meta-api',orderMetaHandler);
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/order-meta-api',orderMetaHandler);
  await page.goto('/?force_vk_auth=1',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>sessionCalls,{timeout:15000}).toBeGreaterThan(0);
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
  expect(await page.evaluate(()=>window.__authScope)).toBe('');
  await page.locator('nav button[data-page="orders"]').click();
  await page.getByRole('button',{name:/Новая/}).click();
  const form=page.locator('#orderForm');
  await form.locator('[name=client]').fill('Тест');
  await form.locator('#bosPhone').fill('9991234567');
  await form.locator('[name=master_vk_id]').selectOption('1001');
  await form.locator('[name=address]').fill('Адрес');
  await form.locator('#bosService').selectOption('4');
  await form.locator('[name=original_amount]').fill('3788');
  await expect(form.locator('#bosMasterPay')).toContainText('1 126,93');
  await form.getByRole('button',{name:'Сохранить'}).click();
  await expect.poll(()=>created).toBeTruthy();
  await expect(page.getByText(/Установка декоративного карниза длиной до 2,5 метров/)).toBeVisible();
});
