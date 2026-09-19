const {test,expect}=require('@playwright/test');

test('mobile VK auth can read signed launch params from VK Bridge once',async({page})=>{
  await page.setViewportSize({width:320,height:700});

  const bridgeBody=`window.vkBridge={send:async(name)=>{if(name==='VKWebAppGetLaunchParams')return {vk_app_id:'54758847',vk_user_id:'123456789',vk_language:'ru',sign:'signed_test_value'};return {}}};`;
  // Keep this test independent of the current CDN/source priority in vk-init.js.
  await page.route('**/*vk-bridge*',route=>route.fulfill({status:200,contentType:'application/javascript',body:bridgeBody}));

  let sessionByLaunch=false,bootstrap=false,sessionRequestBody=null;
  await page.route('**/api/proxy/vk-session-api',async route=>{
    sessionRequestBody=route.request().postDataJSON()||{};
    sessionByLaunch=true;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'123456789.9999999999.testsignature'})});
  });
  await page.route('**/api/proxy/mini-app-api',async route=>{
    const req=route.request(),h=req.headers(),b=req.postDataJSON()||{};
    if(b.action==='bootstrap'){
      expect(h['x-bos-session']).toBeTruthy();
      bootstrap=true;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Первый пользователь',role:'owner',city:'Москва',vk_user_id:'123456789'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });

  await page.goto('/?force_vk_auth=1',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>sessionByLaunch,{timeout:15000}).toBeTruthy();
  await expect.poll(()=>bootstrap,{timeout:15000}).toBeTruthy();
  expect(sessionRequestBody.launch_params).toContain('vk_user_id=123456789');
  expect(sessionRequestBody.access_token).toBeUndefined();
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
});
