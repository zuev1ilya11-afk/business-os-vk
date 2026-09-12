const {test,expect}=require('@playwright/test');

test('standalone desktop opens password login without waiting for VK',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.addInitScript(()=>{
    localStorage.removeItem('bos_vk_session_v2');
    sessionStorage.removeItem('bos_vk_session_v2');
  });
  let vkCalls=0;
  await page.route('**/api/proxy/vk-session-api',route=>{vkCalls++;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'VK should not be called'})})});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Вход по логину'})).toBeVisible({timeout:3000});
  await expect(page.locator('#authPassForm input[name="login"]')).toBeVisible();
  await expect(page.locator('#authPassForm input[name="password"]')).toBeVisible();
  expect(vkCalls).toBe(0);
});

test('desktop password login stores session',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.route('**/api/proxy/password-session-api',async route=>{
    const body=route.request().postDataJSON()||{};
    expect(body.action).toBe('login');
    expect(body.login).toBe('owner-test');
    expect(body.password).toBe('secret-test');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'owner.9999999999.testsignature'})});
  });
  await page.route('**/api/proxy/mini-app-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Владелец',role:'owner',city:'Москва'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[{source:'VK'}],settings:{}})}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.locator('#authPassForm input[name="login"]').fill('owner-test');
  await page.locator('#authPassForm input[name="password"]').fill('secret-test');
  await page.locator('#authPassForm button[type="submit"]').click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('bos_vk_session_v2')),{timeout:5000}).toContain('owner.');
});
