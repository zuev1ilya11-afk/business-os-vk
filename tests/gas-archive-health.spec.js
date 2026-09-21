const {test,expect}=require('@playwright/test');
// APIRequestContext does not automatically honor the runner's HTTPS proxy.
if(process.env.HTTPS_PROXY)test.use({proxy:{server:process.env.HTTPS_PROXY}});

const GAS='https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGljODcR4Uf4wvMc8hA24Dulzdmi-Ek76QH1mQS0tm3Q_ErI1sWEumzQ/exec';
const archiveHealthEnabled=process.env.BOS_TEST_ARCHIVE_GAS==='1';

test.skip(!archiveHealthEnabled,'Archived GAS deployment is an opt-in external health check and must not gate production CI.');

test('Google Apps Script archive deployment is reachable',async({request})=>{
  const r=await request.post(GAS,{form:{action:'ping'}});
  expect(r.ok()).toBeTruthy();
  const text=await r.text();
  const body=JSON.parse(text);
  expect(body).toEqual(expect.objectContaining({ok:false,error:'UNKNOWN_ACTION'}));
});
