const {test,expect}=require('@playwright/test');

test('master schedule save falls back from direct Edge to gateway',async({page})=>{
  let direct=0,primary=0,backup=0,netlify=0;
  await page.route('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api',r=>{direct++;return r.abort('failed')});
  await page.route('https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e/api/proxy/master-workflow-api',r=>{primary++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"route":"primary"}'})});
  await page.route('https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew/api/proxy/master-workflow-api',r=>{backup++;return r.abort('failed')});
  await page.route('https://business-os-api-gateway.netlify.app/api/proxy/master-workflow-api',r=>{netlify++;return r.abort('failed')});

  await page.goto('/');
  await page.evaluate(()=>BOS_NETWORK_DIRECT_V86.clearPreferredTarget('master-workflow-api'));
  direct=primary=backup=netlify=0;

  const result=await page.evaluate(()=>fetch('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/master-workflow-api',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'setAgreementSchedule',id:'test-order',scheduled_date:'2026-09-30',scheduled_time:'16:00'})
  }).then(r=>r.json()));

  expect(result).toEqual({ok:true,route:'primary'});
  expect(direct).toBe(1);
  expect(primary).toBe(1);
  expect(backup).toBe(0);
  expect(netlify).toBe(0);
});
