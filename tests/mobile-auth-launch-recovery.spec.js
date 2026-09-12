const {test,expect}=require('@playwright/test');

test('mobile VK auth can read signed launch params from VK Bridge once',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.route('https://unpkg.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:`window.vkBridge={send:async(name)=>{if(name==='VKWebAppGetLaunchParams')return {vk_app_id:'54758847',vk_user_id:'123456789',vk_language:'ru',sign:'signed_test_value'};return {}}};`}));
  let sessionByLaunch=false,bootstrap=false;
  await page.route('**/api/proxy/vk-session-api',async route=>{const b=route.request().postDataJSON()||{};expect(b.launch_params).toContain('vk_user_id=123456789');expect(b.access_token).toBeUndefined();sessionByLaunch=true;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'123456789.9999999999.testsignature'})})});
  await page.route('**/api/proxy/mini-app-api',async route=>{const req=route.request(),h=req.headers(),b=req.postDataJSON()||{};if(b.action==='bootstrap'){expect(h['x-bos-session']).toBeTruthy();bootstrap=true;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Первый пользователь',role:'owner',city:'Москва',vk_user_id:'123456789'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})})}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})})});
  await page.goto('/?force_vk_auth=1',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>sessionByLaunch,{timeout:15000}).toBeTruthy();
  await expect.poll(()=>bootstrap,{timeout:15000}).toBeTruthy();
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
});
