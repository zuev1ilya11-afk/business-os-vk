const {test,expect}=require('@playwright/test');

test('standalone desktop opens password login immediately and never calls VK auth',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  let vkCalls=0;
  await page.route('**/api/proxy/vk-session-api',async route=>{vkCalls++;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'unexpected'})})});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#authGate')).toContainText('Вход по логину',{timeout:5000});
  expect(vkCalls).toBe(0);
});

test('desktop password login creates BOS session and opens app',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  let loginCalls=0,authenticatedBootstrapCalls=0;
  await page.route('**/api/proxy/password-session-api',async route=>{loginCalls++;const b=route.request().postDataJSON();expect(b.action).toBe('login');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,session_token:'desktop.9999999999.testsignature'})})});
  await page.route('**/api/proxy/mini-app-api',async route=>{const h=route.request().headers(),b=route.request().postDataJSON()||{};if(b.action==='bootstrap'&&h['x-bos-session']==='desktop.9999999999.testsignature')authenticatedBootstrapCalls++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{full_name:'Владелец',role:'owner',city:'Москва'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[],settings:{}})})});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const form=page.locator('#simplePassForm');
  await expect(form).toBeVisible({timeout:5000});
  await form.locator('[name=login]').fill('owner');
  await form.locator('[name=password]').fill('test-password');
  await form.getByRole('button',{name:'Войти'}).click();
  await expect.poll(()=>loginCalls).toBe(1);
  await expect.poll(()=>authenticatedBootstrapCalls).toBeGreaterThan(0);
  await expect(page.getByText('Загруженность мастеров')).toBeVisible();
});
