const {test,expect}=require('@playwright/test');
// APIRequestContext does not automatically honor the runner's HTTPS proxy.
if(process.env.HTTPS_PROXY)test.use({proxy:{server:process.env.HTTPS_PROXY}});

test('signed GAS bridge is reachable and configured',async({request})=>{
  const r=await request.get('https://obsropbslfwtanyspjbi.supabase.co/functions/v1/gas-bridge-health');
  const d=await r.json();
  console.log('SIGNED_GAS_HEALTH',JSON.stringify(d));

  expect(r.ok()).toBeTruthy();
  expect(d.status).toBe(200);

  const raw=String(d.body??'').trim();
  // Google can return its anti-abuse/interstitial HTML to GitHub-hosted runners
  // even though the signed Supabase bridge itself is reachable and returns 200.
  // Keep real bridge/HTTP failures blocking, but do not fail unrelated PRs on
  // this known runner-specific external response.
  if(/^<!doctype html/i.test(raw)&&raw.includes("ppConfig")){
    test.skip(true,'Google Apps Script returned its CI-runner HTML interstitial');
  }

  const body=JSON.parse(raw);
  expect(body.error).toBe('ACT_REQUIRED');
});
