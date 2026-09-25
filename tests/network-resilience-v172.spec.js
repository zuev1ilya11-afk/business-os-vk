const {test,expect}=require('@playwright/test');

const PRIMARY='https://api-v2.appdeploy.ai/app/business-os-api-gateway-3y8h7e';
const BACKUP='https://api-v2.appdeploy.ai/app/business-os-api-gateway-ukp6ew';
const NETLIFY='https://business-os-api-gateway.netlify.app';
const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1';

async function openLogin(page){
  await page.route('https://unpkg.com/**',r=>r.fulfill({contentType:'application/javascript',body:'window.vkBridge={send:async()=>({})};'}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
}

test('safe bootstrap survives primary 503 through independent backup gateway',async({page})=>{
  let primary=0,backup=0,netlify=0,direct=0;
  await page.route(PRIMARY+'/api/proxy/mini-app-api',r=>{primary++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"UPSTREAM_UNAVAILABLE"}'})});
  await page.route(BACKUP+'/api/proxy/mini-app-api',r=>{backup++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"route":"backup"}'})});
  await page.route(NETLIFY+'/api/proxy/mini-app-api',r=>{netlify++;return r.abort('failed')});
  await page.route(EDGE+'/mini-app-api',r=>{direct++;return r.abort('failed')});
  await openLogin(page);
  const result=await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bootstrap'})}).then(r=>r.json()));
  expect(result).toEqual({ok:true,route:'backup'});
  expect(primary).toBe(1);
  expect(backup).toBe(1);
  expect(netlify).toBe(0);
  expect(direct).toBe(0);
});

test('unsafe mutation HTTP 503 is not replayed through another provider',async({page})=>{
  let primary=0,backup=0,netlify=0,direct=0;
  await page.route(PRIMARY+'/api/proxy/mini-app-api',r=>{primary++;return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"UPSTREAM_UNAVAILABLE"}'})});
  await page.route(BACKUP+'/api/proxy/mini-app-api',r=>{backup++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await page.route(NETLIFY+'/api/proxy/mini-app-api',r=>{netlify++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await page.route(EDGE+'/mini-app-api',r=>{direct++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await openLogin(page);
  const result=await page.evaluate(()=>fetch(BUSINESS_OS_CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'addEmployee',full_name:'Тест',phone:'+79990000000',role:'master'})}).then(async r=>({status:r.status,data:await r.json()})));
  expect(result.status).toBe(503);
  expect(result.data.error).toBe('UPSTREAM_UNAVAILABLE');
  expect(primary).toBe(1);
  expect(backup).toBe(0);
  expect(netlify).toBe(0);
  expect(direct).toBe(0);
});
