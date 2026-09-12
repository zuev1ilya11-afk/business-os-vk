const {test,expect}=require('@playwright/test');

test('VK Mini App falls back to Supabase when Netlify gateway is unreachable',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:`window.vkBridge={send:async()=>({})};`}));

  let gatewayAttempts=0,directSession=false,directBootstrap=false;
  await page.route('**/api/proxy/**',route=>{
    gatewayAttempts++;
    return route.abort('failed');
  });

  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/vk-session-api',async route=>{
    const body=route.request().postDataJSON()||{};
    expect(body.launch_params).toContain('vk_user_id=123456789');
    directSession=true;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'123456789.9999999999.testsignature',user:{vk_user_id:'123456789',full_name:'Владелец',role:'owner'}})});
  });

  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api',async route=>{
    const req=route.request(),body=req.postDataJSON()||{};
    if(body.action==='bootstrap'){
      expect(req.headers()['x-bos-session']).toBeTruthy();
      directBootstrap=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Владелец',role:'owner',city:'Москва',vk_user_id:'123456789'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });

  await page.goto('/?force_vk_auth=1&vk_app_id=54758847&vk_user_id=123456789&vk_language=ru&sign=signed_test_value',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>gatewayAttempts,{timeout:15000}).toBeGreaterThan(0);
  await expect.poll(()=>directSession,{timeout:15000}).toBeTruthy();
  await expect.poll(()=>directBootstrap,{timeout:15000}).toBeTruthy();
  await expect(page.getByText('Загруженность мастеров')).toBeVisible({timeout:10000});
});
