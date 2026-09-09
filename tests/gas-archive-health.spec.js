const {test,expect}=require('@playwright/test');

const GAS='https://script.google.com/macros/s/AKfycbx6l6V_jjZdbWQGljODcR4Uf4wvMc8hA24Dulzdmi-Ek76QH1mQS0tm3Q_ErI1sWEumzQ/exec';

test('Google Apps Script archive deployment is reachable',async({request})=>{
  const r=await request.post(GAS,{form:{action:'ping'}});
  expect(r.ok()).toBeTruthy();
  const text=await r.text();
  const body=JSON.parse(text);
  expect(body).toEqual(expect.objectContaining({ok:false,error:'UNKNOWN_ACTION'}));
});
