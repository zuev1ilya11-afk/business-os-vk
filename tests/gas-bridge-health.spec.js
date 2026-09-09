const {test,expect}=require('@playwright/test');

test('signed GAS bridge is reachable and reports configuration state',async({request})=>{
  const r=await request.get('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/gas-bridge-health');
  const d=await r.json();
  console.log('SIGNED_GAS_HEALTH',JSON.stringify(d));

  expect(r.ok()).toBeTruthy();
  expect(d.status).toBe(200);

  const body=JSON.parse(d.body);
  expect(['ACT_REQUIRED','VK_APP_SECRET is not configured']).toContain(body.error);

  if(body.error==='VK_APP_SECRET is not configured'){
    console.warn('GAS archive bridge is deployed, but VK_APP_SECRET still needs to be added to Apps Script Script Properties.');
  }
});
