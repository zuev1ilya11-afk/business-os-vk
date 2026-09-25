const {test,expect}=require('@playwright/test');

test('password login reaches the deployed AppDeploy host, including cached legacy URLs',async({page})=>{
  const api='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai/api/proxy/';
  const oldHost='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
  let apiCalls=0,oldHostCalls=0,reserveCalls=0,authenticatedBootstrap=0;
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route(oldHost+'/**',r=>{oldHostCalls++;return r.fulfill({status:404,contentType:'application/json',body:'{"ok":false}'});});
  await page.route('https://business-os-api-gateway.netlify.app/api/proxy/**',r=>{reserveCalls++;return r.abort('failed');});
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/**',r=>{reserveCalls++;return r.abort('failed');});
  await page.route(api+'password-session-api',r=>{
    apiCalls++;
    expect(r.request().postDataJSON()).toEqual({action:'login',login:'mobile',password:'test-password'});
    return r.fulfill({json:{ok:true,session_token:'mobile.9999999999.test'}});
  });
  await page.route(api+'mini-app-api',r=>{
    if(!r.request().headers()['x-bos-session'])return r.fulfill({status:401,json:{ok:false,error:'Требуется вход'}});
    expect(r.request().headers()['x-bos-session']).toBe('mobile.9999999999.test');
    authenticatedBootstrap++;
    return r.fulfill({json:{ok:true,user:{role:'master',full_name:'Мастер',city:'Москва'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[],settings:{}}});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  expect(await page.evaluate(()=>window.BOS_NETWORK_DIRECT_V86.primaryGateway)).toBe('https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai');
  expect(await page.evaluate(()=>window.BOS_NETWORK_DIRECT_V86.authPrimaryDeadlineMs)).toBe(12000);
  await page.locator('#simplePassForm [name=login]').fill('mobile');
  await page.locator('#simplePassForm [name=password]').fill('test-password');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.locator('#authGate')).toBeHidden();
  const legacy=await page.evaluate(async oldHost=>{
    const r=await fetch(oldHost+'/api/proxy/password-session-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:'mobile',password:'test-password'})});
    return r.json();
  },oldHost);
  expect(legacy.session_token).toBe('mobile.9999999999.test');
  expect(apiCalls).toBe(2);
  expect(authenticatedBootstrap).toBeGreaterThan(0);
  expect(oldHostCalls).toBe(0);
  expect(reserveCalls).toBe(0);
});
