const {test,expect}=require('@playwright/test');
// APIRequestContext does not automatically honor the runner's HTTPS proxy.
if(process.env.HTTPS_PROXY)test.use({proxy:{server:process.env.HTTPS_PROXY}});

test('signed GAS bridge is reachable and configured',async({request})=>{
  const r=await request.get('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/gas-bridge-health');
  const d=await r.json();
  console.log('SIGNED_GAS_HEALTH',JSON.stringify(d));

  expect(r.ok()).toBeTruthy();
  expect(d.status).toBe(200);

  const body=JSON.parse(d.body);
  expect(body.error).toBe('ACT_REQUIRED');
});
