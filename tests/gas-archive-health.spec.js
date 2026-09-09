const {test,expect}=require('@playwright/test');

const GAS='https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGlj0DcR4Uf4wvMc8hA24DuIzdmi-Ek76QH1mQS0tm3Q_Er1IsWEumzQ/exec';

test('Google Apps Script archive deployment is reachable',async({request})=>{
  const r=await request.post(GAS,{form:{action:'ping'}});
  const text=await r.text();
  console.log('GAS_HEALTH_STATUS',r.status());
  console.log('GAS_HEALTH_BODY',text.slice(0,500));
  expect(r.ok()).toBeTruthy();
  let body;
  expect(()=>{body=JSON.parse(text)}).not.toThrow();
  expect(body).toEqual(expect.objectContaining({ok:false,error:'UNKNOWN_ACTION'}));
});
