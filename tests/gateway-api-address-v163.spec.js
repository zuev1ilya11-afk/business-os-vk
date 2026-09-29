const {test,expect}=require('@playwright/test');

test('password login reaches the deployed API host, including legacy gateway URLs',async({page})=>{
  const api='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/';
  const oldHost='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
  let apiCalls=0,oldHostCalls=0,authenticatedBootstrap=0;
  const reserveCalls=[],unexpectedRequests=[];
  // Background presence/renewal must also stay in the fixture, never hit live APIs.
  await page.route('https://**/*',r=>{unexpectedRequests.push(r.request().url());return r.abort('failed');});
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route(oldHost+'/**',r=>{oldHostCalls++;return r.fulfill({status:403,contentType:'text/html',body:'CloudFront: only cacheable methods supported'});});
  await page.route('https://business-os-api-gateway.netlify.app/api/proxy/**',r=>{reserveCalls.push(r.request().url());return r.abort('failed');});
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/**',r=>{reserveCalls.push(r.request().url());return r.abort('failed');});
  await page.route(api+'password-session-api',r=>{
    if(r.request().postDataJSON()?.action==='refresh'){
      expect(r.request().headers()['x-bos-session']).toBe('mobile.9999999999.test');
      return r.fulfill({json:{ok:true,session_token:'mobile.9999999999.test'}});
    }
    apiCalls++;
    expect(r.request().postDataJSON()).toEqual({action:'login',login:'mobile',password:'test-password'});
    return r.fulfill({json:{ok:true,session_token:'mobile.9999999999.test'}});
  });
  await page.route(api+'profile-self-api',r=>{
    expect(r.request().postDataJSON()).toEqual({action:'presence'});
    expect(r.request().headers()['x-bos-session']).toBe('mobile.9999999999.test');
    return r.fulfill({json:{ok:true}});
  });
  await page.route(api+'mini-app-api',r=>{
    if(!r.request().headers()['x-bos-session'])return r.fulfill({status:401,json:{ok:false,error:'Требуется вход'}});
    expect(r.request().headers()['x-bos-session']).toBe('mobile.9999999999.test');
    authenticatedBootstrap++;
    return r.fulfill({json:{ok:true,user:{role:'master',full_name:'Мастер',city:'Москва'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[],settings:{}}});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
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
  expect(reserveCalls).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});
