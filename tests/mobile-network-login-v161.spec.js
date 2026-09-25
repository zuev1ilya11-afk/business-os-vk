const {test,expect,devices}=require('@playwright/test');

test.use({...devices['Pixel 7'],defaultBrowserType:'chromium'});

for(const failure of ['network','timeout','body-timeout','502','504']){
  test(`Android password login uses fallback after primary ${failure}`,async({page})=>{
    const primary='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai';
    const secondary='https://business-os-api-gateway.netlify.app';
    const session='mobile.9999999999.testsignature';
    let primaryCalls=0,alternateCalls=0,authenticatedBootstrap=0,directCalls=0;
    await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
    if(failure==='body-timeout'){
      // Headers arrive, but the cellular connection stalls before the JSON body.
      await page.addInitScript(({primary})=>{
        const native=window.fetch.bind(window);
        window.stalledAuthCalls=0;
        window.fetch=(input,init)=>{
          if(String(input)===primary+'/api/proxy/password-session-api'){
            window.stalledAuthCalls++;
            return Promise.resolve(new Response(new ReadableStream({start(controller){
              init.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
            }}),{headers:{'Content-Type':'application/json'}}));
          }
          return native(input,init);
        };
      },{primary});
    }
    await page.route(primary+'/api/proxy/password-session-api',r=>{
      primaryCalls++;
      if(failure==='network')return r.abort('failed');
      if(failure==='timeout')return;
      return r.fulfill({status:Number(failure),contentType:'application/json',body:JSON.stringify({ok:false,error:'UPSTREAM_UNAVAILABLE'})});
    });
    await page.route(secondary+'/api/proxy/password-session-api',async r=>{
      alternateCalls++;
      expect(r.request().postDataJSON()).toEqual({action:'login',login:'mobile-test',password:'test-password'});
      // A reachable mobile fallback can take longer than the old 2.2s deadline.
      await new Promise(resolve=>setTimeout(resolve,2600));
      await r.fulfill({json:{ok:true,session_token:session}});
    });
    await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/password-session-api',r=>{directCalls++;return r.abort('failed');});
    await page.route('**/api/proxy/mini-app-api',r=>{
      if(r.request().headers()['x-bos-session']===session)authenticatedBootstrap++;
      return r.fulfill({json:{ok:true,user:{full_name:'Мастер',role:'master',city:'Москва'},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[],settings:{}}});
    });
    await page.goto('/',{waitUntil:'domcontentloaded'});
    const form=page.locator('#simplePassForm');
    await form.locator('[name=login]').fill('mobile-test');
    await form.locator('[name=password]').fill('test-password');
    await form.getByRole('button',{name:'Войти',exact:true}).click();
    await expect(page.locator('#authGate')).toBeHidden({timeout:10000});
    await expect(page.locator('#app')).toBeVisible();
    expect(failure==='body-timeout'?await page.evaluate(()=>window.stalledAuthCalls):primaryCalls).toBe(1);
    expect(alternateCalls).toBe(1);
    expect(directCalls).toBe(0);
    expect(authenticatedBootstrap).toBeGreaterThan(0);
    expect(await page.evaluate(()=>sessionStorage.getItem('bos_vk_session_v2'))).toBe(session);
  });
}
