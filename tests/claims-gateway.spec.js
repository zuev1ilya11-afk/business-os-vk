const {test,expect}=require('@playwright/test');

test('claims module uses Netlify gateway',async({page})=>{
  let claimsCalls=0;
  await page.route('**/api/proxy/claims-api',async route=>{
    claimsCalls++;
    const body=route.request().postDataJSON()||{};
    expect(body.action).toBe('bootstrap');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,claims:[],orders:[],masters:[]})});
  });
  await page.route('**/api/proxy/mini-app-api',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,user:{id:'owner1',full_name:'Владелец',role:'owner',is_active:true},orders:[],users:[],masters:[],masterSchedule:[],claims:[],sources:[],settings:{}})}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{if(typeof refreshClaims==='function')await refreshClaims()});
  await expect.poll(()=>claimsCalls).toBeGreaterThan(0);
});
