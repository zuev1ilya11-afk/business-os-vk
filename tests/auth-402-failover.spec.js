const {test,expect}=require('@playwright/test');

async function authPage(page){
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.goto('/');
}

test('password login fails over when primary gateway returns 402',async({page})=>{
  let primary=0,backup=0,netlify=0,direct=0;
  await page.route('https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/password-session-api',r=>{primary++;return r.fulfill({status:402,contentType:'application/json',body:'{"ok":false,"error":"Payment Required"}'})});
  await page.route('https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew/api/proxy/password-session-api',r=>{backup++;return r.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Неверный пароль через резерв"}'})});
  await page.route('https://business-os-api-gateway.netlify.app/api/proxy/password-session-api',r=>{netlify++;return r.abort('failed')});
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/password-session-api',r=>{direct++;return r.abort('failed')});
  await authPage(page);
  await page.locator('#simplePassForm [name=login]').fill('audit');
  await page.locator('#simplePassForm [name=password]').fill('invalid');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.locator('#simplePassMsg')).toHaveText('Неверный пароль через резерв',{timeout:8000});
  expect(primary).toBe(1);
  expect(backup).toBe(1);
  expect(netlify).toBe(0);
  expect(direct).toBe(0);
});

test('bootstrap fails over when primary gateway returns 402',async({page})=>{
  let primary=0,backup=0;
  await page.route('https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/mini-app-api',r=>{primary++;return r.fulfill({status:402,contentType:'application/json',body:'{"ok":false,"error":"Payment Required"}'})});
  await page.route('https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew/api/proxy/mini-app-api',r=>{backup++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"route":"backup"}'})});
  await authPage(page);
  await page.evaluate(()=>BOS_NETWORK_DIRECT_V86.clearPreferredTarget('mini-app-api'));
  primary=backup=0;
  const result=await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"bootstrap"}'}).then(r=>r.json()));
  expect(result).toEqual({ok:true,route:'backup'});
  expect(primary).toBe(1);
  expect(backup).toBe(1);
});
