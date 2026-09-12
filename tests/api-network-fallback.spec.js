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

async function networkPage(page){
  await page.route('**/network-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="content"></div>'}));
  await page.goto('/network-test');
  await page.evaluate(()=>{window.cfg={};window.state={};window.reloadData=async()=>{};window.$=s=>document.querySelector(s);window.esc=String;});
  await page.addScriptTag({url:'/network-fallback-v50.js'});
  await page.addScriptTag({url:'/vk-auth-patch.js'});
}
const gateway='https://business-os-api-gateway.netlify.app/api/proxy/mini-app-api';
const direct='https://obsropbslfwtanyspjbi.supabase.co/functions/v1/mini-app-api';

for(const status of [200,401,403,500]){
  test(`HTTP ${status} does not trigger fallback`,async({page})=>{
    let directCalls=0;
    await page.route(gateway,r=>r.fulfill({status,body:'response'}));
    await page.route(direct,r=>{directCalls++;return r.fulfill({body:'unexpected'});});
    await networkPage(page);
    expect(await page.evaluate(async url=>(await fetch(url)).status,gateway)).toBe(status);
    expect(directCalls).toBe(0);
  });
}

test('Request body and init overrides survive one retry through both wrappers',async({page})=>{
  const calls=[];
  await page.route(gateway,async r=>{calls.push({url:r.request().url(),body:r.request().postData(),headers:r.request().headers(),method:r.request().method()});await r.abort('failed');});
  await page.route(direct,async r=>{calls.push({url:r.request().url(),body:r.request().postData(),headers:r.request().headers(),method:r.request().method()});await r.fulfill({body:'ok'});});
  await networkPage(page);
  expect(await page.evaluate(async url=>{
    const request=new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-BOS-Session':'original'},body:'{"action":"bootstrap"}'});
    return (await fetch(request,{headers:{'Content-Type':'application/json','X-BOS-Session':'override'}})).text();
  },direct)).toBe('ok');
  expect(calls.map(c=>c.url)).toEqual([gateway,direct]);
  for(const c of calls){expect(c.body).toBe('{"action":"bootstrap"}');expect(c.headers['x-bos-session']).toBe('override');expect(c.method).toBe('POST');}
});

test('both endpoints unavailable give Russian error and exactly one direct attempt',async({page})=>{
  let gatewayCalls=0,directCalls=0;
  await page.route(gateway,r=>{gatewayCalls++;return r.abort('failed');});
  await page.route(direct,r=>{directCalls++;return r.abort('failed');});
  await networkPage(page);
  const result=await page.evaluate(async url=>{try{await fetch(new URL(url));}catch(e){return{message:e.message,code:e.code,primary:window.BOS_NETWORK_LAST_ERROR.primaryError.message,fallback:window.BOS_NETWORK_LAST_ERROR.fallbackError.message};}},direct);
  expect(result.message).toContain('Не удалось связаться с сервером');
  expect(result.code).toBe('BOS_NETWORK_UNAVAILABLE');
  expect(result.primary).toBeTruthy();expect(result.fallback).toBeTruthy();
  expect(gatewayCalls).toBe(1);expect(directCalls).toBe(1);
});

test('abort and invalid request do not trigger fallback',async({page})=>{
  let directCalls=0;
  await page.route(direct,r=>{directCalls++;return r.fulfill({body:'unexpected'});});
  await networkPage(page);
  const result=await page.evaluate(async url=>{
    const controller=new AbortController();controller.abort();
    const names=[];
    try{await fetch(url,{signal:controller.signal});}catch(e){names.push(e.name);}
    try{await fetch(url,{method:'GET',body:'invalid'});}catch(e){names.push(e.name);}
    return names;
  },gateway);
  expect(result).toEqual(['AbortError','TypeError']);expect(directCalls).toBe(0);
});

test('VK auth screen explains outage when both servers are unreachable',async({page})=>{
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.route('**/api/proxy/**',r=>r.abort('failed'));
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/**',r=>r.abort('failed'));
  await page.goto('/?force_vk_auth=1&vk_app_id=54758847&vk_user_id=123456789&sign=signed_test_value');
  await expect(page.locator('#authGate')).toContainText('Не удалось связаться с сервером',{timeout:20000});
  await expect(page.locator('#authGate')).not.toContainText('Load failed');
  expect(await page.evaluate(()=>document.body.classList.contains('bos-auth-ok'))).toBe(false);
});
